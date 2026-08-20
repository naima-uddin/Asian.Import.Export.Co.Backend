const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const Inquiry = require("../models/Inquiry");
const Invoice = require("../models/Invoice");
const User = require("../models/User");

const isStaffRole = (role) => ["admin", "moderator"].includes(role);

const generateCode = (prefix) => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${y}${m}${d}-${rand}`;
};

const parseMoney = (value) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const numeric = Number(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(numeric) ? numeric : 0;
  }

  return 0;
};

const sanitizeText = (value, fallback = "") => {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized || fallback;
};

const parseDiscount = (value) => {
  const amount = parseMoney(value);
  return amount >= 0 ? amount : 0;
};

const roundCurrency = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const sanitizePaymentMethod = (method, fallback = "bank") => {
  const value = sanitizeText(method, "");
  return value || fallback;
};

const toLineItem = (item = {}) => {
  const quantity = Number(item.quantity || 0);
  const inferredLineTotal = parseMoney(item.lineTotal ?? item.total ?? item.calculatedPrice);
  const unitPriceCandidate = item.unitPrice ?? item.price;
  const unitPrice = parseMoney(
    unitPriceCandidate ?? (quantity > 0 && inferredLineTotal > 0 ? inferredLineTotal / quantity : 0)
  );
  const discount = parseDiscount(item.discount);
  const grossLineTotal = quantity * unitPrice;
  const lineTotal =
    inferredLineTotal > 0 ? inferredLineTotal : Math.max(grossLineTotal - discount, 0);

  return {
    productId: item.productId ? String(item.productId) : item.id ? String(item.id) : "",
    name: sanitizeText(String(item.name || "")),
    title: sanitizeText(String(item.title || item.name || "")),
    brand: sanitizeText(String(item.brand || "")),
    pattern: sanitizeText(String(item.pattern || "")),
    size: sanitizeText(String(item.size || "")),
    ply: sanitizeText(String(item.ply || "")),
    image: item.image ? String(item.image) : "",
    quantity,
    unitPrice,
    discount,
    lineTotal,
  };
};

const sanitizeItems = (items = []) => {
  if (!Array.isArray(items)) return [];

  return items
    .map(toLineItem)
    .filter(
      (item) =>
        item.name &&
        Number.isFinite(item.quantity) &&
        item.quantity > 0 &&
        Number.isFinite(item.unitPrice) &&
        item.unitPrice >= 0 &&
        Number.isFinite(item.lineTotal) &&
        item.lineTotal >= 0
    );
};

const summarizePaymentStatus = (total, paidAmount) => {
  if (paidAmount <= 0) return "unpaid";
  if (paidAmount >= total) return "full";
  return "partial";
};

const toPaymentMethod = (method) => sanitizePaymentMethod(method, "bank");

const paymentMethodLabel = (method) => {
  const normalized = String(method || "bank").trim().toLowerCase();

  switch (normalized) {
    case "credit-card":
      return "Credit Card";
    case "bank":
      return "Bank Transfer";
    case "cash":
      return "Cash";
    case "cheque":
      return "Cheque";
    case "wire-transfer":
      return "Wire Transfer";
    case "mobile-banking":
      return "Mobile Banking";
    default:
      return sanitizeText(method, "Bank Transfer");
  }
};

const paymentStatusLabel = (status) => {
  const normalized = String(status || "unpaid").trim().toLowerCase();

  switch (normalized) {
    case "due":
      return "Due";
    case "unpaid":
      return "Unpaid";
    case "partial":
      return "Partial";
    case "full":
    case "paid":
      return "Full";
    default:
      return normalized || "Unpaid";
  }
};

const normalizeCustomerSnapshot = ({ customer = {}, authUser = null, fallback = null }) => {
  const source = customer || {};
  const fallbackSource = fallback || {};

  const normalized = {
    name: sanitizeText(source.name, sanitizeText(fallbackSource.name, sanitizeText(authUser?.fullName || ""))),
    email: sanitizeText(source.email, sanitizeText(fallbackSource.email, sanitizeText(authUser?.email || ""))).toLowerCase(),
    phone: sanitizeText(source.phone, sanitizeText(fallbackSource.phone, sanitizeText(authUser?.whatsappNumber || ""))),
    companyName: sanitizeText(
      source.companyName,
      sanitizeText(fallbackSource.companyName, sanitizeText(authUser?.companyName || ""))
    ),
    address: sanitizeText(source.address, sanitizeText(fallbackSource.address, "")),
    city: sanitizeText(source.city, sanitizeText(fallbackSource.city, "")),
    state: sanitizeText(source.state, sanitizeText(fallbackSource.state, "")),
    zone: sanitizeText(
      source.zone,
      sanitizeText(fallbackSource.zone, sanitizeText(source.state, sanitizeText(fallbackSource.state, "")))
    ),
    zipCode: sanitizeText(
      source.zipCode || source.postalCode,
      sanitizeText(fallbackSource.zipCode || fallbackSource.postalCode, "")
    ),
    notes: sanitizeText(source.notes, sanitizeText(fallbackSource.notes, "")),
    whatsappNumber: sanitizeText(
      source.whatsappNumber,
      sanitizeText(fallbackSource.whatsappNumber, sanitizeText(authUser?.whatsappNumber || ""))
    ),
    paymentMethod: toPaymentMethod(source.paymentMethod || fallbackSource.paymentMethod),
  };

  return normalized;
};

const inquiryRequiredCustomerFields = [
  "name",
  "email",
  "phone",
  "address",
  "city",
  "zone",
];

const invoiceRequiredCustomerFields = [...inquiryRequiredCustomerFields];

const validateCustomerSnapshot = (snapshot, requiredFields = inquiryRequiredCustomerFields) => {
  for (const field of requiredFields) {
    if (!snapshot?.[field] || !String(snapshot[field]).trim()) {
      return field;
    }
  }

  return null;
};

const toEmailDeliveryErrorMessage = (error, fallbackMessage) => {
  if (error?.code === "EAUTH" || error?.responseCode === 535) {
    return "SMTP authentication failed. Verify SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASSWORD. If using Gmail, use an App Password.";
  }

  return error?.message || fallbackMessage;
};

const createTransporter = () => {
  const user = String(process.env.SMTP_USER || process.env.OWNER_EMAIL || "").trim();
  const rawPassword = String(process.env.SMTP_PASSWORD || "");
  let pass = rawPassword.trim();
  const rawHost = String(process.env.SMTP_HOST || "").trim().toLowerCase();
  const domain = user.split("@")[1]?.toLowerCase() || "";
  let host = rawHost;

  // Gmail app passwords are often copied with spaces; other providers may require spaces.
  if (domain === "gmail.com") {
    pass = pass.replace(/\s+/g, "");
  }

  if (domain === "gmail.com") host = "smtp.gmail.com";
  else if (domain === "outlook.com" || domain === "hotmail.com" || domain === "live.com") {
    host = "smtp.office365.com";
  } else if (!host || host.includes("@")) {
    host = "";
  } else {
    const looksLikePlainDomain = host.includes(".") && !host.startsWith("smtp.") && !host.startsWith("mail.");
    if (looksLikePlainDomain) {
      if (host === "asianimportexport.com" || domain === "asianimportexport.com") {
          host = "mail.asianimportexport.com";
      } else {
          host = `smtp.${host}`;
      }
    }
  }

  const port = Number(process.env.SMTP_PORT || 465);
  const secure = port === 465;
  const relaxTlsForHost = host === "mail.asianimportexport.com";

  if (!user || !pass || !host) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: relaxTlsForHost ? { rejectUnauthorized: false } : undefined,
  });
};

const toPdfCurrency = (value) => `$${Number(value || 0).toFixed(2)}`;

const COMPANY_INFO = {
  name: "ASIAN IMPORT AND EXPORT CO Ltd",
  contact: "+14379003996",
  email: "info@asianimportexport.com",
  mobile: "+6621055786",
  address:
    "63/16 Soi Chumchon Talat Tha Ruea Khlong Toei Khwaeng Khlong Toei, Khet Khlong Toei Krung Thep Maha Nakhon 10110, Thailand",
};

const SALES_EMAIL = process.env.SMTP_USER || process.env.SALES_EMAIL || "sale@asianimportexport.com";

const getLineValue = (text, label) => {
  if (!text) return "";
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(text).match(new RegExp(`(?:^|\\n)${escaped}:\\s*(.+)`, "i"));
  return match?.[1]?.trim() || "";
};

const toDateLabel = (value, fallbackDate = new Date()) => {
  if (!value) return fallbackDate.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
};

const getLogoPath = () => {
  const candidates = [
    path.resolve(__dirname, "../public/logo.png"),
    path.resolve(__dirname, "../public/logo.webp"),
    path.resolve(__dirname, "../../Asian.Import.Export.Co.Frontend/public/logo.png"),
    path.resolve(__dirname, "../../Asian.Import.Export.Co.Frontend/public/logo.webp"),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
};

let cachedInvoiceLogoSource;
let cachedInvoiceLogoLoaded = false;

const sanitizeBaseUrl = (value) => String(value || "").trim().replace(/\/+$/, "");

const getInvoiceLogoUrlCandidates = () => {
  const explicit = [
    process.env.INVOICE_LOGO_URL,
    process.env.PDF_LOGO_URL,
    process.env.LOGO_URL,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  const frontendBase = sanitizeBaseUrl(process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.WEBSITE_URL);
  if (!frontendBase) {
    return explicit;
  }

  return [
    ...explicit,
    `${frontendBase}/logo.png`,
    `${frontendBase}/logo.webp`,
    `${frontendBase}/assets/logo.png`,
    `${frontendBase}/assets/logo.webp`,
  ];
};

const getInvoiceLogoSource = async () => {
  if (cachedInvoiceLogoLoaded) {
    return cachedInvoiceLogoSource;
  }

  const localLogoPath = getLogoPath();
  if (localLogoPath) {
    cachedInvoiceLogoSource = localLogoPath;
    cachedInvoiceLogoLoaded = true;
    return cachedInvoiceLogoSource;
  }

  const urls = getInvoiceLogoUrlCandidates();
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        continue;
      }

      const bytes = await response.arrayBuffer();
      const buffer = Buffer.from(bytes);
      if (!buffer.length) {
        continue;
      }

      cachedInvoiceLogoSource = buffer;
      cachedInvoiceLogoLoaded = true;
      return cachedInvoiceLogoSource;
    } catch (fetchError) {
      console.error("Invoice logo fetch failed:", fetchError);
      // Try the next URL candidate.
    }
  }

  cachedInvoiceLogoSource = null;
  cachedInvoiceLogoLoaded = true;
  return null;
};

const generateInvoicePdfBuffer = async (invoice) => {
  const logoSource = await getInvoiceLogoSource();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 42 });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 42;
    const tableX = margin;
    const tableWidth = pageWidth - margin * 2;
    const issueDate = getLineValue(invoice.notes, "Issue Date") || invoice.issuedAt || invoice.createdAt;
    const validityDate = getLineValue(invoice.notes, "Validity Date") || new Date(Date.now() + 4 * 86400000);
    const paymentTerms = getLineValue(invoice.notes, "Payment Terms");
    const productionTime = getLineValue(invoice.notes, "Production Time");
    const portOfLoading = getLineValue(invoice.notes, "Port Of Loading");
    const deliveryAddress = getLineValue(invoice.notes, "Delivery Address");
    const incoterms = getLineValue(invoice.additionalMessages, "Incoterms") || "";
    const bankDetails = getLineValue(invoice.termsAndConditions, "Bank Details") || "";

    let y = margin;
    const logoPath = typeof logoSource === "string" && fs.existsSync(logoSource) ? logoSource : null;
    const logoBuffer = logoPath ? null : logoSource;

    if (logoPath || logoBuffer) {
      doc.save();
      try {
        doc.opacity(0.09);
        const watermarkWidth = Math.min(400, pageWidth - margin * 2);
        doc.image(
          logoPath || logoBuffer,
          pageWidth / 2 - watermarkWidth / 2,
          pageHeight / 2 - watermarkWidth / 2 - 60,
          {
            fit: [watermarkWidth, watermarkWidth],
            align: "center",
            valign: "center",
          }
        );
      } catch (logoError) {
        console.error("PDF logo render failed:", logoError);
      } finally {
        doc.restore();
      }
    }

    doc.fillOpacity(1);
    doc.strokeOpacity(1);
    doc.fillColor("#111827");
    doc.strokeColor("#111827");

    const drawCell = (x, y, w, h, label, value, options = {}) => {
      const {
        bg,
        align = "left",
        labelSize = 9,
        valueSize = 9.5,
        multiline = false,
        labelColor = "#111827",
        valueColor = "#111827",
        labelFont = "Helvetica-Bold",
        valueFont = "Helvetica",
        borders = { top: true, right: true, bottom: true, left: true },
      } = options;

      if (bg) {
        doc.save();
        doc.rect(x, y, w, h).fill(bg);
        doc.restore();
      }

      if (borders.top) {
        doc.moveTo(x, y).lineTo(x + w, y).stroke();
      }
      if (borders.right) {
        doc.moveTo(x + w, y).lineTo(x + w, y + h).stroke();
      }
      if (borders.bottom) {
        doc.moveTo(x, y + h).lineTo(x + w, y + h).stroke();
      }
      if (borders.left) {
        doc.moveTo(x, y).lineTo(x, y + h).stroke();
      }
      if (label) {
        doc.fillColor(labelColor).font(labelFont).fontSize(labelSize).text(label, x + 6, y + 5, {
          width: w - 12,
          align,
          lineBreak: true,
        });
      }
      if (value !== undefined && value !== null) {
        doc.fillColor(valueColor).font(valueFont).fontSize(valueSize).text(String(value), x + 6, y + (label ? 18 : 8), {
          width: w - 12,
          height: h - (label ? 20 : 8),
          align,
          lineBreak: multiline,
          ellipsis: multiline ? false : true,
        });
      }
    };

    doc.rect(tableX, y, tableWidth, pageHeight - margin * 2).stroke();

    const headerRowHeight = 44;
    drawCell(tableX, y, tableWidth, headerRowHeight, "", "");
    doc.font("Helvetica-Bold").fontSize(18).text("ASIAN IMPORT EXPORT CO., LTD", tableX, y + 12, {
      width: tableWidth,
      align: "center",
    });
    y += headerRowHeight;

    drawCell(tableX, y, tableWidth, 32, "", "");
    doc.font("Helvetica-Bold").fontSize(14).text("Proforma Invoice", tableX, y + 8, {
      width: tableWidth,
      align: "center",
    });
    y += 32;

    const c1 = tableWidth * 0.15;
    const c2 = tableWidth * 0.18;
    const c3 = tableWidth * 0.2;
    const c4 = tableWidth - c1 - c2 - c3;
    const x1 = tableX;
    const x2 = x1 + c1;
    const x3 = x2 + c2;
    const x4 = x3 + c3;

    const rowHeight = 30;
    drawCell(x1, y, c1, rowHeight, "", "SC No:");
    drawCell(x2, y, c2, rowHeight, "", invoice.invoiceNumber || "");
    drawCell(x3, y, c3, rowHeight, "", "Issue Date:");
    drawCell(x4, y, c4, rowHeight, "", toDateLabel(issueDate));
    y += rowHeight;

    drawCell(x1, y, c1, rowHeight, "", "");
    drawCell(x2, y, c2, rowHeight, "", "");
    drawCell(x3, y, c3, rowHeight, "", "Validity of contract:");
    drawCell(x4, y, c4, rowHeight, "", toDateLabel(validityDate));
    y += rowHeight;

    const customer = invoice.customerSnapshot || {};
    const customerName = customer.companyName || customer.name || "";
    const customerAddress = [customer.address, customer.city, customer.zone, customer.zipCode]
      .filter(Boolean)
      .join(", ");

    const drawDualRow = (leftLabel, leftValue, rightLabel, rightValue, height = 30) => {
      const half = tableWidth / 2;
      const lx = tableX;
      const rx = tableX + half;
      drawCell(lx, y, half * 0.3, height, "", leftLabel);
      drawCell(lx + half * 0.3, y, half * 0.7, height, "", leftValue || "", { multiline: height >= 40, valueSize: 9 });
      drawCell(rx, y, half * 0.3, height, "", rightLabel);
      drawCell(rx + half * 0.3, y, half * 0.7, height, "", rightValue || "", { multiline: height >= 40, valueSize: 9 });
      y += height;
    };

    drawDualRow("To:", customerName, "From:", COMPANY_INFO.name);
    drawDualRow("Contact:", customer.phone || "", "Contact:", COMPANY_INFO.contact);
    drawDualRow("Email:", customer.email || "", "Email:", COMPANY_INFO.email);
    drawDualRow("Mobile:", customer.whatsappNumber || customer.phone || "", "Mobile:", COMPANY_INFO.mobile);
    drawDualRow("Address:", customerAddress, "Address:", COMPANY_INFO.address, 44);

    drawCell(tableX, y, tableWidth * 0.3, 30, "", "Payment Terms:", { bg: "#edf2e5", valueSize: 9, valueColor: "#000000" });
    drawCell(tableX + tableWidth * 0.3, y, tableWidth * 0.7, 30, "", "* " + paymentTerms, { bg: "#edf2e5", valueSize: 10,valueColor: "#006312",});
    y += 30;

    drawDualRow("Production Time:", productionTime, "", "", 28);
    drawDualRow("Port of Loading:", portOfLoading, "Delivery Address:", deliveryAddress, 34);

    drawCell(tableX, y, tableWidth, 30, "", "");
    doc.font("Helvetica-Bold").fontSize(14).text("Product Description:", tableX, y + 8, {
      width: tableWidth,
      align: "center",
    });
    y += 30;

    const pCols = [0.16, 0.12, 0.1, 0.08, 0.1, 0.08, 0.16, 0.2];
    const pWidths = pCols.map((ratio) => ratio * tableWidth);
    const pXs = pWidths.reduce((acc, w, i) => {
      acc.push((acc[i - 1] || tableX) + (i === 0 ? 0 : pWidths[i - 1]));
      return acc;
    }, []);

    const headerHeight = 30;
    const headers = ["Product Name", "Brand", "Pattern", "Ply", "Size", "QTY", "Unit Price\n(USD/Pics)", "Total Price (USD)"];
    headers.forEach((header, index) => drawCell(pXs[index], y, pWidths[index], headerHeight, "", header));
    y += headerHeight;

    const items = Array.isArray(invoice.items) ? invoice.items : [];
    const maxRows = 7;
    const visibleItems = items.slice(0, maxRows);
    visibleItems.forEach((item) => {
      const row = [
        sanitizeText(item.title || item.name || "-"),
        sanitizeText(String(item.brand || "-"), "-"),
        sanitizeText(String(item.pattern || "-"), "-"),
        sanitizeText(String(item.ply || "-"), "-"),
        sanitizeText(String(item.size || "-"), "-"),
        String(item.quantity || 0),
        toPdfCurrency(item.unitPrice),
        toPdfCurrency(item.lineTotal),
      ];
      row.forEach((cell, index) => drawCell(pXs[index], y, pWidths[index], 28, "", cell, { valueSize: 9.5 }));
      y += 28;
    });

    if (items.length > visibleItems.length) {
      drawCell(tableX, y, tableWidth, 24, "", `+ ${items.length - visibleItems.length} more item(s) included`);
      y += 24;
    }

    const summaryHeight = 84;
    const leftWidth = tableWidth * 0.52;
    const middleWidth = tableWidth * 0.20;
    const rightWidth = tableWidth - leftWidth - middleWidth;
    drawCell(tableX, y, leftWidth, summaryHeight, "", "", {
      bg: "#ffffff",
    });
    if (Number(invoice.discountRate || 0) > 0) {
      drawCell(
        tableX + leftWidth,
        y,
        middleWidth,
        summaryHeight,
        "Final Amount:",
        `(${Number(invoice.discountRate || 0).toFixed(0)}% discount added)`,
        {
          labelSize: 11,
          valueSize: 11,
          valueFont: "Helvetica-Bold",
          valueColor: "#f97316",
          bg: "#dbeafe",
        }
      );
    } else {
      drawCell(tableX + leftWidth, y, middleWidth, summaryHeight, "Final Amount:", "", {
        labelSize: 11,
        valueSize: 11,
        bg: "#dbeafe",
      });
    }
    drawCell(tableX + leftWidth + middleWidth, y, rightWidth, summaryHeight, "", toPdfCurrency(invoice.total), {
      valueSize: 18,
      valueFont: "Helvetica-Bold",
      valueColor: "#111827",
      bg: "#dbeafe",
    });
    y += summaryHeight;

    const bottomHeight = Math.max(pageHeight - margin - y, 72);
    drawCell(tableX, y, tableWidth - 150, bottomHeight, "", bankDetails ? `Bank Details: ${bankDetails}` : "Bank Details: N/A", {
      multiline: true,
      labelSize: 11,
      valueSize: 10,
      valueFont: "Helvetica-Bold",
      bg: "#ffffff",
    });
    drawCell(tableX + tableWidth - 150, y, 150, bottomHeight, "", `Incoterms: ${incoterms || "N/A"}`, {
      borders: { top: true, right: true, bottom: true, left: false },
    });

    doc.end();
  });
};

const sendInquiryReceivedEmails = async (inquiry) => {
  const transporter = createTransporter();

  if (!transporter) {
    return {
      sent: false,
      message: "SMTP credentials not configured",
    };
  }

  const senderAddress = process.env.SMTP_USER || process.env.OWNER_EMAIL || SALES_EMAIL;
  const customer = inquiry.customerSnapshot || {};
  const customerEmail = sanitizeText(customer.email, "").toLowerCase();

  const itemRows = (inquiry.items || [])
    .map(
      (item) => `
        <tr>
          <td style="border:1px solid #ddd;padding:8px;">${item.title || item.name}</td>
          <td style="border:1px solid #ddd;padding:8px;text-align:center;">${item.quantity}</td>
          <td style="border:1px solid #ddd;padding:8px;text-align:right;">$${Number(item.unitPrice || 0).toFixed(2)}</td>
          <td style="border:1px solid #ddd;padding:8px;text-align:right;">$${Number(item.lineTotal || 0).toFixed(2)}</td>
        </tr>
      `
    )
    .join("");

  const customerHtml = `
    <div style="background:#f3f6fb;padding:24px 12px;font-family:Arial,sans-serif;color:#1f2937;">
      <div style="max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #dbe3ef;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,0.08);">
        <div style="background:linear-gradient(120deg,#0f766e,#14b8a6);padding:20px 24px;color:#fff;">
          <div style="font-size:12px;opacity:0.9;letter-spacing:0.4px;">CHECKOUT INQUIRY RECEIVED</div>
          <h2 style="margin:8px 0 2px 0;font-size:26px;">${inquiry.inquiryNumber}</h2>
          <div style="font-size:14px;opacity:0.95;">Hello ${customer.name || "Customer"}, our sales team will contact and confirm shortly.</div>
        </div>

        <div style="padding:18px 22px;">
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
            <span style="background:#ecfeff;color:#0f766e;border:1px solid #99f6e4;padding:6px 10px;border-radius:999px;font-size:12px;font-weight:700;">Payment: ${paymentMethodLabel(customer.paymentMethod)}</span>
            <span style="background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;padding:6px 10px;border-radius:999px;font-size:12px;font-weight:700;">Total: $${Number(inquiry.total || 0).toFixed(2)}</span>
          </div>

          <table style="border-collapse:collapse;width:100%;margin:14px 0;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
            <thead>
              <tr style="background:#0f766e;color:#fff;">
                <th style="padding:10px;text-align:left;">Product</th>
                <th style="padding:10px;text-align:center;">Qty</th>
                <th style="padding:10px;text-align:right;">Unit</th>
                <th style="padding:10px;text-align:right;">Total</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>
          

          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:14px;line-height:1.6;">
            <div><strong>Buyer Details</strong></div>
            <div><strong>Name:</strong> ${customer.name || "N/A"}</div>
            <div><strong>Company:</strong> ${customer.companyName || "N/A"}</div>
            <div><strong>Email:</strong> ${customer.email || "N/A"}</div>
            <div><strong>Phone:</strong> ${customer.phone || "N/A"}</div>
            <div><strong>Address:</strong> ${[customer.address, customer.city, customer.state || customer.zone, customer.zipCode]
              .filter(Boolean)
              .join(", ") || "N/A"}</div>
          </div>

          ${customer.notes ? `<div style="background:#fff7ed;border:1px solid #fde3c7;border-radius:10px;padding:14px 16px;margin-bottom:14px;line-height:1.6;"><strong>Message:</strong><div>${customer.notes}</div></div>` : ""}

          

          <p style="margin:14px 0 0 0;font-size:14px;color:#475569;">
            Thank you for choosing Asian Import Export Co. We will send your invoice very shortly.
          </p>
        </div>
      </div>
    </div>
  `;

  const adminHtml = `
    <div style="background:#f3f6fb;padding:24px 12px;font-family:Arial,sans-serif;color:#1f2937;">
      <div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #dbe3ef;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,0.08);">
        <div style="background:linear-gradient(120deg,#111827,#1f2937);padding:20px 24px;color:#fff;">
          <div style="font-size:12px;opacity:0.9;letter-spacing:0.4px;">NEW CHECKOUT INQUIRY</div>
          <h2 style="margin:8px 0 2px 0;font-size:25px;">${inquiry.inquiryNumber}</h2>
          <div style="font-size:14px;opacity:0.9;">Customer inquiry received and ready for follow-up.</div>
        </div>

        <div style="padding:18px 22px;">
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:14px;line-height:1.55;">
            <div><strong>Customer:</strong> ${customer.name || "N/A"}</div>
            <div><strong>Login/Register Email:</strong> ${customerEmail || "N/A"}</div>
            <div><strong>Phone:</strong> ${customer.phone || "N/A"}</div>
            <div><strong>Address:</strong> ${[customer.address, customer.city, customer.zone, customer.zipCode].filter(Boolean).join(", ") || "N/A"}</div>
            ${customer.notes ? `<div><strong>Notes:</strong> ${customer.notes}</div>` : ""}
          </div>

          <table style="border-collapse:collapse;width:100%;margin:14px 0;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
            <thead>
              <tr style="background:#0f766e;color:#fff;">
                <th style="padding:10px;text-align:left;">Product</th>
                <th style="padding:10px;text-align:center;">Qty</th>
                <th style="padding:10px;text-align:right;">Unit</th>
                <th style="padding:10px;text-align:right;">Total</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>

          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <span style="background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;padding:6px 10px;border-radius:999px;font-size:12px;font-weight:700;">Total: $${Number(inquiry.total || 0).toFixed(2)}</span>
            <span style="background:#ecfeff;color:#0f766e;border:1px solid #99f6e4;padding:6px 10px;border-radius:999px;font-size:12px;font-weight:700;">Payment: ${paymentMethodLabel(customer.paymentMethod)}</span>
          </div>
        </div>
      </div>
    </div>
  `;

  const mailTasks = [
    transporter.sendMail({
      from: `"Asian Import Export Co" <${senderAddress}>`,
      to: SALES_EMAIL,
      replyTo: customerEmail || undefined,
      subject: `New Inquiry ${inquiry.inquiryNumber} from Checkout`,
      html: adminHtml,
    }),
  ];

  if (customerEmail) {
    mailTasks.push(
      transporter.sendMail({
        from: `"Asian Import Export Co" <${senderAddress}>`,
        to: customerEmail,
        subject: `Inquiry ${inquiry.inquiryNumber} received`,
        html: customerHtml,
      })
    );
  }

  await Promise.all(mailTasks);

  return {
    sent: true,
    message: "Inquiry emails sent",
  };
};

const sendInvoiceEmail = async (invoice) => {
  const transporter = createTransporter();

  if (!transporter) {
    return {
      sent: false,
      message: "SMTP credentials not configured",
    };
  }

  const pdfBuffer = await generateInvoicePdfBuffer(invoice);
  const customer = invoice.customerSnapshot || {};
  const accountCustomer = await User.findById(invoice.customer).select("email").lean();
  const customerEmail = sanitizeText(
    accountCustomer?.email || customer?.email || "",
    ""
  ).toLowerCase();
  const senderAddress = process.env.SMTP_USER || process.env.OWNER_EMAIL || SALES_EMAIL;
  const rows = (invoice.items || [])
    .map(
      (item) => `
        <tr>
          <td style="border:1px solid #ddd;padding:8px;">${item.title || item.name}</td>
          <td style="border:1px solid #ddd;padding:8px;text-align:center;">${item.quantity}</td>
          <td style="border:1px solid #ddd;padding:8px;text-align:right;">$${Number(item.unitPrice || 0).toFixed(2)}</td>
          <td style="border:1px solid #ddd;padding:8px;text-align:right;">$${Number(item.discount || 0).toFixed(2)}</td>
          <td style="border:1px solid #ddd;padding:8px;text-align:right;">$${Number(item.lineTotal || 0).toFixed(2)}</td>
        </tr>
      `
    )
    .join("");

  const html = `
    <div style="background:#f3f6fb;padding:24px 12px;font-family:Arial,sans-serif;color:#1f2937;">
      <div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #dbe3ef;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,0.08);">
        <div style="background:linear-gradient(120deg,#0f766e,#14b8a6);padding:20px 24px;color:#fff;">
          <div style="font-size:12px;opacity:0.9;letter-spacing:0.4px;">INVOICE READY</div>
          <h2 style="margin:8px 0 2px 0;font-size:26px;">${invoice.invoiceNumber}</h2>
          <div style="font-size:14px;opacity:0.95;">Hello ${customer.name || "Customer"}, your invoice summary is below. PDF is attached.</div>
        </div>

        <div style="padding:18px 22px;">
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
            <span style="background:#ecfeff;color:#0f766e;border:1px solid #99f6e4;padding:6px 10px;border-radius:999px;font-size:12px;font-weight:700;">Payment: ${paymentMethodLabel(customer.paymentMethod)}</span>
            <span style="background:#eef2ff;color:#4338ca;border:1px solid #c7d2fe;padding:6px 10px;border-radius:999px;font-size:12px;font-weight:700;">Status: ${paymentStatusLabel(invoice.paymentStatus)}</span>
            <span style="background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;padding:6px 10px;border-radius:999px;font-size:12px;font-weight:700;">Total: $${Number(invoice.total || 0).toFixed(2)}</span>
          </div>

          <table style="border-collapse:collapse;width:100%;margin:12px 0;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
            <thead>
              <tr style="background:#0f766e;color:#fff;">
                <th style="padding:10px;text-align:left;">Product</th>
                <th style="padding:10px;text-align:center;">Qty</th>
                <th style="padding:10px;text-align:right;">Unit</th>
                <th style="padding:10px;text-align:right;">Discount</th>
                <th style="padding:10px;text-align:right;">Total</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>

          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;line-height:1.65;">
            <div><strong>Product subtotal:</strong> $${Number(invoice.productSubtotal || 0).toFixed(2)}</div>
            <div><strong>VAT:</strong> $${Number(invoice.vatAmount || 0).toFixed(2)}</div>
            <div><strong>Discount:</strong> -$${Number(invoice.discountAmount || 0).toFixed(2)}</div>
            <div><strong>Shipping:</strong> $${Number(invoice.shippingCost || 0).toFixed(2)}</div>
            <div><strong>Total:</strong> $${Number(invoice.total || 0).toFixed(2)}</div>
            <div><strong>Paid:</strong> $${Number(invoice.paidAmount || 0).toFixed(2)}</div>
            <div><strong>Balance Due:</strong> $${Number(invoice.balanceDue || 0).toFixed(2)}</div>
          </div>

          ${invoice.notes ? `<p style="margin:12px 0 0 0;"><strong>Notes:</strong> ${invoice.notes}</p>` : ""}
          ${invoice.extraNotes ? `<p style="margin:8px 0 0 0;"><strong>Extra Notes:</strong> ${invoice.extraNotes}</p>` : ""}
          ${invoice.termsAndConditions ? `<p style="margin:8px 0 0 0;"><strong>Terms & Conditions:</strong> ${invoice.termsAndConditions}</p>` : ""}
          ${invoice.additionalMessages ? `<p style="margin:8px 0 0 0;"><strong>Additional Messages:</strong> ${invoice.additionalMessages}</p>` : ""}
        </div>
      </div>
    </div>
  `;

  const adminHtml = `
    <div style="background:#f3f6fb;padding:24px 12px;font-family:Arial,sans-serif;color:#1f2937;">
      <div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #dbe3ef;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,0.08);">
        <div style="background:linear-gradient(120deg,#111827,#1f2937);padding:20px 24px;color:#fff;">
          <div style="font-size:12px;opacity:0.9;letter-spacing:0.4px;">INVOICE GENERATED</div>
          <h2 style="margin:8px 0 2px 0;font-size:25px;">${invoice.invoiceNumber}</h2>
          <div style="font-size:14px;opacity:0.9;">PDF attached. Customer and sales copies are being delivered.</div>
        </div>

        <div style="padding:18px 22px;">
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:12px;line-height:1.55;">
            <div><strong>Customer:</strong> ${customer?.name || "N/A"}</div>
            <div><strong>Customer Email:</strong> ${customerEmail || "N/A"}</div>
            <div><strong>Total:</strong> $${Number(invoice.total || 0).toFixed(2)}</div>
            <div><strong>Payment Status:</strong> ${paymentStatusLabel(invoice.paymentStatus)}</div>
          </div>
          ${html}
        </div>
      </div>
    </div>
  `;

  const attachments = [
    {
      filename: `${invoice.invoiceNumber}.pdf`,
      content: pdfBuffer,
    },
  ];

  const deliveries = [
    transporter.sendMail({
      from: `"Asian Import Export Co" <${senderAddress}>`,
      to: SALES_EMAIL,
      subject: `Invoice ${invoice.invoiceNumber} generated`,
      html: adminHtml,
      attachments,
    }),
  ];

  if (customerEmail) {
    deliveries.push(
      transporter.sendMail({
        from: `"Asian Import Export Co" <${senderAddress}>`,
        to: customerEmail,
        subject: `Invoice ${invoice.invoiceNumber} from Asian Import Export`,
        html,
        attachments,
      })
    );
  }

  await Promise.all(deliveries);

  return {
    sent: true,
    message: "Invoice emails sent to sales and customer",
  };
};

const mapInquiry = (inquiry) => ({
  id: inquiry._id,
  inquiryNumber: inquiry.inquiryNumber,
  customerId: inquiry.customer,
  isGuest: Boolean(inquiry.isGuest),
  customer: inquiry.customerSnapshot,
  items: inquiry.items,
  subtotal: inquiry.subtotal,
  total: inquiry.total,
  currency: inquiry.currency,
  paymentMethod: inquiry.paymentMethod,
  status: inquiry.status,
  contactChannel: inquiry.contactChannel,
  internalNotes: inquiry.internalNotes,
  payment: inquiry.payment,
  linkedInvoice: inquiry.linkedInvoice,
  hiddenByCustomer: Boolean(inquiry.hiddenByCustomer),
  hiddenAt: inquiry.hiddenAt || null,
  createdAt: inquiry.createdAt,
  updatedAt: inquiry.updatedAt,
});

const mapInvoice = (invoice) => ({
  id: invoice._id,
  invoiceNumber: invoice.invoiceNumber,
  inquiryId: invoice.inquiry,
  customerId: invoice.customer,
  customer: invoice.customerSnapshot,
  items: invoice.items,
  subtotal: invoice.subtotal,
  productSubtotal: invoice.productSubtotal,
  vatRate: invoice.vatRate,
  vatAmount: invoice.vatAmount,
  discountRate: invoice.discountRate,
  discountAmount: invoice.discountAmount,
  shippingCost: invoice.shippingCost,
  total: invoice.total,
  paidAmount: invoice.paidAmount,
  balanceDue: invoice.balanceDue,
  paymentStatus: invoice.paymentStatus,
  currency: invoice.currency,
  invoiceStatus: invoice.invoiceStatus,
  notes: invoice.notes,
  extraNotes: invoice.extraNotes,
  termsAndConditions: invoice.termsAndConditions,
  additionalMessages: invoice.additionalMessages,
  issuedAt: invoice.issuedAt,
  createdBy: invoice.createdBy,
  createdAt: invoice.createdAt,
  updatedAt: invoice.updatedAt,
});

const placeOrderInquiry = async (req, res) => {
  try {
    const authUser = req.authUser || null;

    // Guest checkout is allowed. Only block logged-in non-customer accounts
    // (admin/moderator) from placing orders through their own session.
    if (authUser && authUser.role !== "customer") {
      return res.status(403).json({
        success: false,
        message: "Admin/Moderator accounts cannot place orders",
      });
    }

    const isGuest = !authUser;

    const { customer, items, paymentMethod, currency = "USD" } = req.body;

    const lineItems = sanitizeItems(items);
    if (lineItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one valid item is required",
      });
    }

    const customerSnapshot = normalizeCustomerSnapshot({ customer, authUser });
    // For logged-in customers, keep the inquiry email aligned with the account
    // email. Guests provide their contact email directly on the form.
    const accountEmail = sanitizeText(authUser?.email || "", "").toLowerCase();
    if (accountEmail) {
      customerSnapshot.email = accountEmail;
    }
    const missingField = validateCustomerSnapshot(customerSnapshot, inquiryRequiredCustomerFields);

    if (missingField) {
      return res.status(400).json({
        success: false,
        message: `Missing customer field: ${missingField}`,
      });
    }

    const subtotal = lineItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const total = subtotal;

    const inquiry = await Inquiry.create({
      inquiryNumber: generateCode("INQ"),
      customer: authUser?._id || null,
      isGuest,
      customerSnapshot,
      items: lineItems,
      subtotal,
      total,
      currency,
      paymentMethod: paymentMethod === "credit-card" ? "credit-card" : "bank",
      status: "in_process",
    });

    let emailDelivery = {
      sent: false,
      message: "Inquiry email not attempted",
    };
    try {
      emailDelivery = await sendInquiryReceivedEmails(inquiry);
    } catch (emailError) {
      emailDelivery = {
        sent: false,
        message: toEmailDeliveryErrorMessage(emailError, "Failed to send inquiry email"),
      };
      console.error("Inquiry email send error:", emailError);
    }

    return res.status(201).json({
      success: true,
      message: "Inquiry created successfully",
      inquiry: mapInquiry(inquiry),
      emailDelivery,
    });
  } catch (error) {
    console.error("Place order inquiry error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create inquiry",
      error: error.message,
    });
  }
};

const getMyInquiries = async (req, res) => {
  try {
    const inquiries = await Inquiry.find({
      customer: req.authUser._id,
      hiddenByCustomer: { $ne: true },
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      inquiries: inquiries.map(mapInquiry),
    });
  } catch (error) {
    console.error("Get my inquiries error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch inquiries" });
  }
};

const getAllInquiries = async (req, res) => {
  try {
    if (!isStaffRole(req.authUser?.role)) {
      return res.status(403).json({ success: false, message: "Staff access required" });
    }

    const status = req.query.status;
    const query = status ? { status } : {};

    const inquiries = await Inquiry.find(query).sort({ createdAt: -1 }).lean();

    return res.status(200).json({
      success: true,
      inquiries: inquiries.map(mapInquiry),
    });
  } catch (error) {
    console.error("Get all inquiries error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch inquiries" });
  }
};

const deleteInquiry = async (req, res) => {
  try {
    const { inquiryId } = req.params;
    if (!inquiryId || !mongoose.Types.ObjectId.isValid(inquiryId)) {
      return res.status(400).json({ success: false, message: "Valid inquiryId is required" });
    }

    const inquiry = await Inquiry.findById(inquiryId);
    if (!inquiry) {
      return res.status(404).json({ success: false, message: "Inquiry not found" });
    }

    const authRole = req.authUser?.role;
    const isAdmin = authRole === "admin";
    const isOwner = String(inquiry.customer) === String(req.authUser?._id);

    if (isAdmin) {
      if (inquiry.linkedInvoice) {
        return res.status(400).json({
          success: false,
          message: "Cannot delete an inquiry that already has an invoice",
        });
      }
      await Inquiry.deleteOne({ _id: inquiryId });
      return res.status(200).json({ success: true, message: "Inquiry deleted successfully" });
    }

    if (!isOwner) {
      return res.status(403).json({
        success: false,
        message: "You can only delete your own inquiries",
      });
    }

    inquiry.hiddenByCustomer = true;
    inquiry.hiddenAt = new Date();
    await inquiry.save();

    return res.status(200).json({
      success: true,
      message: "Inquiry removed from your dashboard",
    });
  } catch (error) {
    console.error("Delete inquiry error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete inquiry" });
  }
};

const updateInquiryStatus = async (req, res) => {
  try {
    if (!isStaffRole(req.authUser?.role)) {
      return res.status(403).json({ success: false, message: "Staff access required" });
    }

    const { inquiryId } = req.params;
    const { status, internalNotes, contactChannel } = req.body;

    const allowedStatuses = ["in_process", "invoice_sent", "cancelled"];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid inquiry status" });
    }

    const inquiry = await Inquiry.findById(inquiryId);
    if (!inquiry) {
      return res.status(404).json({ success: false, message: "Inquiry not found" });
    }

    inquiry.status = status;

    if (typeof internalNotes === "string") {
      inquiry.internalNotes = internalNotes.trim();
    }

    if (["email", "whatsapp", "phone", "mixed"].includes(contactChannel)) {
      inquiry.contactChannel = contactChannel;
    }

    await inquiry.save();

    return res.status(200).json({
      success: true,
      message: "Inquiry status updated",
      inquiry: mapInquiry(inquiry),
    });
  } catch (error) {
    console.error("Update inquiry status error:", error);
    return res.status(500).json({ success: false, message: "Failed to update inquiry status" });
  }
};

const createInvoiceFromInquiry = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (req.authUser?.role !== "admin") {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const {
      inquiryId,
      items,
      customer = {},
      paidAmount = 0,
      notes = "",
      extraNotes = "",
      termsAndConditions = "",
      additionalMessages = "",
      vatRate = 0,
      discountRate = 0,
      shippingCost = 0,
      invoiceNumber,
      currency = "USD",
    } = req.body;

    if (!inquiryId || !mongoose.Types.ObjectId.isValid(inquiryId)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "Valid inquiryId is required" });
    }

    const inquiry = await Inquiry.findById(inquiryId).session(session);
    if (!inquiry) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "Inquiry not found" });
    }

    if (inquiry.linkedInvoice) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "Invoice already exists for this inquiry" });
    }

    const invoiceItems = sanitizeItems(items?.length ? items : inquiry.items);
    if (invoiceItems.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "At least one valid invoice item is required" });
    }

    const customerSnapshot = normalizeCustomerSnapshot({
      customer,
      fallback: {
        ...inquiry.customerSnapshot,
        paymentMethod: inquiry.paymentMethod,
      },
    });

    const accountCustomer = await User.findById(inquiry.customer)
      .select("email")
      .session(session);
    const accountEmail = sanitizeText(
      accountCustomer?.email || inquiry.customerSnapshot?.email || "",
      ""
    ).toLowerCase();

    if (!accountEmail) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Customer account email is missing",
      });
    }

    // Always keep invoice email aligned with login/register account email.
    customerSnapshot.email = accountEmail;

    const missingCustomerField = validateCustomerSnapshot(customerSnapshot, invoiceRequiredCustomerFields);
    if (missingCustomerField) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Missing customer field: ${missingCustomerField}`,
      });
    }

    const productSubtotal = roundCurrency(invoiceItems.reduce((sum, item) => sum + item.lineTotal, 0));
    const normalizedVatRate = Math.max(Number(vatRate) || 0, 0);
    const normalizedDiscountRate = Math.max(Number(discountRate) || 0, 0);
    const normalizedShippingCost = Math.max(Number(shippingCost) || 0, 0);
    const vatAmount = roundCurrency((productSubtotal * normalizedVatRate) / 100);
    const discountAmount = roundCurrency((productSubtotal * normalizedDiscountRate) / 100);
    const subtotal = roundCurrency(Math.max(productSubtotal + vatAmount - discountAmount + normalizedShippingCost, 0));
    const total = subtotal;
    const normalizedPaidAmount = Math.max(Number(paidAmount) || 0, 0);
    const balanceDue = Math.max(total - normalizedPaidAmount, 0);

    const invoice = await Invoice.create(
      [
        {
          invoiceNumber: sanitizeText(invoiceNumber, generateCode("INV")),
          inquiry: inquiry._id,
          customer: inquiry.customer,
          customerSnapshot,
          items: invoiceItems,
          productSubtotal,
          vatRate: normalizedVatRate,
          vatAmount,
          discountRate: normalizedDiscountRate,
          discountAmount,
          shippingCost: normalizedShippingCost,
          subtotal,
          total,
          paidAmount: normalizedPaidAmount,
          balanceDue,
          paymentStatus: summarizePaymentStatus(total, normalizedPaidAmount),
          currency: String(currency || inquiry.currency || "USD").trim(),
          notes: String(notes || "").trim(),
          extraNotes: String(extraNotes || "").trim(),
          termsAndConditions: String(termsAndConditions || "").trim(),
          additionalMessages: String(additionalMessages || "").trim(),
          createdBy: {
            id: String(req.authUser._id),
            name: req.authUser.fullName || "",
            email: req.authUser.email || "",
            role: req.authUser.role || "",
          },
        },
      ],
      { session }
    );

    inquiry.status = "invoice_sent";
    inquiry.linkedInvoice = invoice[0]._id;
    inquiry.payment.paidAmount = normalizedPaidAmount;
    inquiry.payment.confirmed = normalizedPaidAmount > 0;
    inquiry.payment.confirmedAt = normalizedPaidAmount > 0 ? new Date() : inquiry.payment.confirmedAt;
    await inquiry.save({ session });

    await session.commitTransaction();
    session.endSession();

    let emailDelivery = {
      sent: false,
      message: "Email not attempted",
    };
    try {
      emailDelivery = await sendInvoiceEmail(invoice[0]);
    } catch (emailError) {
      emailDelivery = {
        sent: false,
        message: toEmailDeliveryErrorMessage(emailError, "Failed to send invoice email"),
      };
      console.error("Invoice email send error:", emailError);
    }

    return res.status(201).json({
      success: true,
      message: "Invoice created successfully",
      invoice: mapInvoice(invoice[0]),
      inquiry: mapInquiry(inquiry),
      emailDelivery,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Create invoice error:", error);
    return res.status(500).json({ success: false, message: "Failed to create invoice", error: error.message });
  }
};

const downloadInvoicePdf = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    if (!invoiceId || !mongoose.Types.ObjectId.isValid(invoiceId)) {
      return res.status(400).json({ success: false, message: "Valid invoiceId is required" });
    }

    const invoice = await Invoice.findById(invoiceId).lean();
    if (!invoice) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }

    const isOwner = String(invoice.customer) === String(req.authUser?._id);
    const isStaff = isStaffRole(req.authUser?.role);

    if (!isOwner && !isStaff) {
      return res.status(403).json({ success: false, message: "Not allowed to download this invoice" });
    }

    const pdfBuffer = await generateInvoicePdfBuffer(invoice);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=\"${invoice.invoiceNumber}.pdf\"`);
    return res.status(200).send(pdfBuffer);
  } catch (error) {
    console.error("Download invoice PDF error:", error);
    return res.status(500).json({ success: false, message: "Failed to download invoice PDF" });
  }
};

const getMyInvoices = async (req, res) => {
  try {
    let customerId = req.authUser._id;

    if (req.authUser.role === "admin" || req.authUser.role === "moderator") {
      const customerUid = req.query.customerUid;
      if (customerUid) {
        const customer = await User.findOne({ firebaseUid: customerUid });
        if (customer) {
          customerId = customer._id;
        }
      }
    }

    const invoices = await Invoice.find({ customer: customerId }).sort({ createdAt: -1 }).lean();

    return res.status(200).json({
      success: true,
      invoices: invoices.map(mapInvoice),
    });
  } catch (error) {
    console.error("Get my invoices error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch invoices" });
  }
};

const getAllInvoices = async (req, res) => {
  try {
    if (!isStaffRole(req.authUser?.role)) {
      return res.status(403).json({ success: false, message: "Staff access required" });
    }

    const invoices = await Invoice.find({}).sort({ createdAt: -1 }).lean();

    return res.status(200).json({
      success: true,
      invoices: invoices.map(mapInvoice),
    });
  } catch (error) {
    console.error("Get all invoices error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch invoices" });
  }
};

const deleteInvoice = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (req.authUser?.role !== "admin") {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const { invoiceId } = req.params;
    if (!invoiceId || !mongoose.Types.ObjectId.isValid(invoiceId)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "Valid invoiceId is required" });
    }

    const invoice = await Invoice.findById(invoiceId).session(session);
    if (!invoice) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }

    const inquiry = await Inquiry.findById(invoice.inquiry).session(session);
    if (inquiry) {
      inquiry.linkedInvoice = null;
      inquiry.status = "in_process";
      inquiry.payment.confirmed = false;
      inquiry.payment.paidAmount = 0;
      inquiry.payment.confirmedAt = null;
      await inquiry.save({ session });
    }

    await Invoice.deleteOne({ _id: invoice._id }).session(session);

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({ success: true, message: "Invoice deleted successfully" });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Delete invoice error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete invoice" });
  }
};

module.exports = {
  placeOrderInquiry,
  getMyInquiries,
  getAllInquiries,
  updateInquiryStatus,
  deleteInquiry,
  createInvoiceFromInquiry,
  getMyInvoices,
  getAllInvoices,
  deleteInvoice,
  downloadInvoicePdf,
};
