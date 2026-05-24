require("dotenv").config();
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const connectDB = require("./config/db");
const seedDefaultAdmin = require("./config/seedDefaultAdmin");
const userRoutes = require("./routes/userRoutes");
const orderFlowRoutes = require("./routes/orderFlowRoutes");
const addressRoutes = require("./routes/addressRoutes");
const catalogRoutes = require("./routes/catalogRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const siteSettingsRoutes = require("./routes/siteSettingsRoutes");

const app = express();

const GENERAL_CONTACT_EMAIL =
  process.env.GENERAL_CONTACT_EMAIL ||
  "info@asianimportexport.com";
const SALES_EMAIL = process.env.SALES_EMAIL || process.env.SMTP_USER || "sale@asianimportexport.com";

const resolveSmtpHost = (rawHost, userEmail) => {
  const host = String(rawHost || "").trim().toLowerCase();
  const domain = String(userEmail || "").split("@")[1]?.toLowerCase() || "";

  if (domain === "gmail.com") return "smtp.gmail.com";
  if (domain === "outlook.com" || domain === "hotmail.com" || domain === "live.com") {
    return "smtp.office365.com";
  }

  if (!host || host.includes("@")) return "";

  // If only the website domain is given (e.g. asianimportexport.com), convert to a usable SMTP host.
  const looksLikePlainDomain = host.includes(".") && !host.startsWith("smtp.") && !host.startsWith("mail.");
  if (looksLikePlainDomain) {
    if (host === "asianimportexport.com" || domain === "asianimportexport.com") {
      return "mail.asianimportexport.com";
    }
    return `smtp.${host}`;
  }

  return host;
};

const createMailTransporter = () => {
  const user = String(process.env.SMTP_USER || process.env.OWNER_EMAIL || "").trim();
  const rawPassword = String(process.env.SMTP_PASSWORD || "");
  let pass = rawPassword.trim();
  const host = resolveSmtpHost(process.env.SMTP_HOST, user);
  const port = Number(process.env.SMTP_PORT || 465);
  const domain = user.split("@")[1]?.toLowerCase() || "";
  const secure = port === 465;
  const relaxTlsForHost = host === "mail.asianimportexport.com";

  // Gmail app passwords are often copied with spaces; other providers may require spaces.
  if (domain === "gmail.com") {
    pass = pass.replace(/\s+/g, "");
  }

  if (!user || !pass || !host) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: relaxTlsForHost ? { rejectUnauthorized: false } : undefined,
  });
};

// Connect to MongoDB
connectDB();
seedDefaultAdmin();

app.use(
  cors({
    // Reflect request origin and allow all origins.
    origin: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);
app.use(express.json());

// User routes
app.use("/api/users", userRoutes);
app.use("/api", orderFlowRoutes);
app.use("/api/addresses", addressRoutes);
app.use("/api/catalog", catalogRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/site-settings", siteSettingsRoutes);

// Email endpoint
app.post("/api/send-email", async (req, res) => {
  const {
    name,
    email,
    phone,
    company,
    message,
    address,
    quantity,
    model,
    type,
    subject,
    shippingTerm, // optional
  } = req.body;

  const transporter = createMailTransporter();

  if (!transporter) {
    return res.status(500).json({ error: "SMTP is not configured" });
  }

  try {
    let emailSubject, textContent, htmlContent;

    if (type === "product_inquiry") {
      // Product inquiry (from ContactModal)
      emailSubject = `Product Inquiry: ${model} (${quantity} units)`;

      textContent = `
        PRODUCT INQUIRY
        ================
        Product: ${model}
        Quantity: ${quantity} units
        Shipping Terms: ${shippingTerm || "Not provided"}
        ----------------------------
        Customer Details:
        Name: ${name}
        Email: ${email}
        Phone: ${phone || "Not provided"}
        ${company ? `Company: ${company}\n` : ""}
        Address: ${address || "Not provided"}
        ----------------------------
        Customer Message:
        ${message}
        ================
              `;

      htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
          <h2 style="color: #e67e22; border-bottom: 2px solid #e67e22; padding-bottom: 5px;">
            PRODUCT INQUIRY
          </h2>

          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 15px;">
            <h3 style="margin-top: 0;">
              <strong>Product:</strong> ${model}<br>
              <strong>Quantity:</strong> ${quantity} units<br>
              <strong>Shipping Terms:</strong> ${shippingTerm || "Not provided"}
            </h3>
          </div>

          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr style="background: #e67e22; color: white;">
              <th colspan="2" style="padding: 10px; text-align: left;">CUSTOMER DETAILS</th>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #ddd; width: 30%;"><strong>Name:</strong></td>
              <td style="padding: 10px; border: 1px solid #ddd;">${name}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #ddd;"><strong>Email:</strong></td>
              <td style="padding: 10px; border: 1px solid #ddd;">${email}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #ddd;"><strong>Phone:</strong></td>
              <td style="padding: 10px; border: 1px solid #ddd;">${phone || "Not provided"}</td>
            </tr>
            ${
              company
                ? `<tr>
                    <td style="padding: 10px; border: 1px solid #ddd;"><strong>Company:</strong></td>
                    <td style="padding: 10px; border: 1px solid #ddd;">${company}</td>
                  </tr>`
                : ""
            }
            <tr>
              <td style="padding: 10px; border: 1px solid #ddd;"><strong>Address:</strong></td>
              <td style="padding: 10px; border: 1px solid #ddd;">${address || "Not provided"}</td>
            </tr>
          </table>

          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px;">
            <h4 style="margin-top: 0; color: #e67e22;">CUSTOMER MESSAGE:</h4>
            <p style="white-space: pre-wrap; margin-bottom: 0;">${message}</p>
          </div>
        </div>
      `;
    } else {
      // General inquiry (from ContactPage)
      emailSubject = subject || "General Inquiry from Website";
      textContent = `
        GENERAL INQUIRY
        ================
        Customer Details:
        Name: ${name}
        Email: ${email}
        Phone: ${phone || "Not provided"}
        ${company ? `Company: ${company}\n` : ""}
        ----------------------------
        Customer Message:
        ${message}
        ================
              `;

        htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
          <h2 style="color: #e67e22; border-bottom: 2px solid #e67e22; padding-bottom: 5px;">
            GENERAL INQUIRY
          </h2>

          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr style="background: #e67e22; color: white;">
              <th colspan="2" style="padding: 10px; text-align: left;">CUSTOMER DETAILS</th>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #ddd; width: 30%;"><strong>Name:</strong></td>
              <td style="padding: 10px; border: 1px solid #ddd;">${name}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #ddd;"><strong>Email:</strong></td>
              <td style="padding: 10px; border: 1px solid #ddd;">${email}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #ddd;"><strong>Phone:</strong></td>
              <td style="padding: 10px; border: 1px solid #ddd;">${phone || "Not provided"}</td>
            </tr>
            ${
              company
                ? `<tr>
                    <td style="padding: 10px; border: 1px solid #ddd;"><strong>Company:</strong></td>
                    <td style="padding: 10px; border: 1px solid #ddd;">${company}</td>
                  </tr>`
                : ""
            }
          </table>

          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px;">
            <h4 style="margin-top: 0; color: #e67e22;">CUSTOMER MESSAGE:</h4>
            <p style="white-space: pre-wrap; margin-bottom: 0;">${message}</p>
          </div>
        </div>
      `;
    }

    const isProductInquiry = type === "product_inquiry";
    const senderAddress = isProductInquiry ? SALES_EMAIL : GENERAL_CONTACT_EMAIL;
    const adminRecipient = isProductInquiry
      ? SALES_EMAIL
      : GENERAL_CONTACT_EMAIL || senderAddress;

    await transporter.sendMail({
      from: `"Asian Import Export Co" <${senderAddress}>`,
      to: adminRecipient,
      replyTo: email,
      subject: emailSubject,
      text: textContent,
      html: htmlContent,
    });

    if (!isProductInquiry && email) {
      const customerAckSubject = "We received your inquiry - Asian Import Export Co";
      const customerAckText = `Hello ${name || "Customer"},\n\nThank you for contacting Asian Import Export Co. We have received your inquiry and our team will reply soon.\n\nYour message:\n${message || ""}\n\nBest regards,\nAsian Import Export Co`;
      const customerAckHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
          <h2 style="color: #0f766e; border-bottom: 2px solid #0f766e; padding-bottom: 6px;">Inquiry Received</h2>
          <p>Hello ${name || "Customer"},</p>
          <p>Thank you for contacting <strong>Asian Import Export Co</strong>. We have received your inquiry and our team will reply shortly.</p>
          <div style="background: #f8fafc; border: 1px solid #e5e7eb; padding: 12px; border-radius: 6px; margin-top: 14px;">
            <p style="margin: 0 0 8px 0;"><strong>Your message:</strong></p>
            <p style="margin: 0; white-space: pre-wrap;">${message || "No message provided."}</p>
          </div>
          <p style="margin-top: 18px;">General contact: <a href="mailto:${GENERAL_CONTACT_EMAIL}" style="color:#0f766e;">${GENERAL_CONTACT_EMAIL}</a></p>
        </div>
      `;

      await transporter.sendMail({
        from: `"Asian Import Export Co" <${senderAddress}>`,
        to: email,
        subject: customerAckSubject,
        text: customerAckText,
        html: customerAckHtml,
      });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error sending email:", error);
    res.status(500).json({ error: "Failed to send email" });
  }
});

// Invoice email endpoint for cart orders
app.post("/api/send-invoice", async (req, res) => {
  const { customer, items, subtotal, total, orderDate, paymentMethod } = req.body;

  const transporter = createMailTransporter();

  if (!transporter) {
    return res.status(500).json({ error: "SMTP is not configured" });
  }

  try {
    const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    const formattedDate = new Date(orderDate).toLocaleString("en-US", {
      dateStyle: "full",
      timeStyle: "short",
    });

    // Generate items HTML
    const itemsHTML = items
      .map(
        (item) => `
      <tr>
        <td style="padding: 10px; border: 1px solid #ddd;">${item.name}</td>
        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${item.quantity}</td>
        <td style="padding: 10px; border: 1px solid #ddd; text-align: right;">$${parseFloat(item.price).toFixed(2)}</td>
        <td style="padding: 10px; border: 1px solid #ddd; text-align: right;">$${(parseFloat(item.price) * item.quantity).toFixed(2)}</td>
      </tr>
    `
      )
      .join("");

    // Email to customer
    const customerEmailHTML = `
      <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; background: #fff; border: 1px solid #ddd;">
        <div style="background: linear-gradient(135deg, #0d9488 0%, #14b8a6 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">Order Confirmation</h1>
          <p style="color: #e0f2f1; margin: 10px 0 0 0;">Thank you for your order!</p>
        </div>

        <div style="padding: 30px;">
          <div style="background: #f0fdfa; border-left: 4px solid #14b8a6; padding: 15px; margin-bottom: 25px;">
            <h2 style="margin: 0 0 10px 0; color: #0d9488;">Order Details</h2>
            <p style="margin: 5px 0; color: #666;">
              <strong>Order ID:</strong> ${orderId}<br>
              <strong>Order Date:</strong> ${formattedDate}<br>
              <strong>Payment Method:</strong> ${paymentMethod === "credit-card" ? "Credit Card" : "Bank Transfer"}
            </p>
          </div>

          <h3 style="color: #0d9488; border-bottom: 2px solid #14b8a6; padding-bottom: 10px;">Shipping Information</h3>
          <table style="width: 100%; margin-bottom: 25px;">
            <tr>
              <td style="padding: 5px 0;"><strong>Name:</strong></td>
              <td style="padding: 5px 0;">${customer.name}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0;"><strong>Email:</strong></td>
              <td style="padding: 5px 0;">${customer.email}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0;"><strong>Phone:</strong></td>
              <td style="padding: 5px 0;">${customer.phone}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; vertical-align: top;"><strong>Address:</strong></td>
              <td style="padding: 5px 0;">${customer.address}<br>${[customer.city, customer.zone, customer.zipCode].filter(Boolean).join(", ")}</td>
            </tr>
            ${customer.notes ? `
            <tr>
              <td style="padding: 5px 0; vertical-align: top;"><strong>Notes:</strong></td>
              <td style="padding: 5px 0;">${customer.notes}</td>
            </tr>
            ` : ""}
          </table>

          <h3 style="color: #0d9488; border-bottom: 2px solid #14b8a6; padding-bottom: 10px;">Order Items</h3>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
            <thead>
              <tr style="background: #0d9488; color: white;">
                <th style="padding: 12px; text-align: left;">Product</th>
                <th style="padding: 12px; text-align: center; width: 80px;">Qty</th>
                <th style="padding: 12px; text-align: right; width: 100px;">Price</th>
                <th style="padding: 12px; text-align: right; width: 100px;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHTML}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3" style="padding: 15px; text-align: right; border: 1px solid #ddd; border-top: 2px solid #0d9488;"><strong>Subtotal:</strong></td>
                <td style="padding: 15px; text-align: right; border: 1px solid #ddd; border-top: 2px solid #0d9488;"><strong>$${subtotal.toFixed(2)}</strong></td>
              </tr>
              <tr>
                <td colspan="3" style="padding: 15px; text-align: right; background: #f0fdfa; border: 1px solid #ddd; font-size: 18px;"><strong>Total:</strong></td>
                <td style="padding: 15px; text-align: right; background: #f0fdfa; border: 1px solid #ddd; font-size: 18px; color: #0d9488;"><strong>$${total.toFixed(2)} USD</strong></td>
              </tr>
            </tfoot>
          </table>

          <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 25px 0;">
            <h4 style="margin: 0 0 10px 0; color: #92400e;">Next Steps</h4>
            <p style="margin: 5px 0; color: #78350f;">
              ${paymentMethod === "credit-card" 
                ? "Our team will contact you shortly with payment instructions for your credit card payment."
                : "Our team will contact you shortly with bank transfer details and payment instructions."
              }
            </p>
            <p style="margin: 10px 0 0 0; color: #78350f;">
              If you have any questions, please don't hesitate to contact us via WhatsApp or email.
            </p>
          </div>

          <div style="text-align: center; padding: 20px; background: #f9fafb; border-radius: 5px; margin-top: 25px;">
            <p style="margin: 0; color: #666; font-size: 14px;">
              Thank you for choosing Asian Import Export Co<br>
              <a href="tel:14379003996" style="color: #0d9488; text-decoration: none;">+1 (437) 900-3996</a> | 
              <a href="mailto:${process.env.OWNER_EMAIL}" style="color: #0d9488; text-decoration: none;">${process.env.OWNER_EMAIL}</a>
            </p>
          </div>
        </div>
      </div>
    `;

    // Email to owner/admin
    const adminEmailHTML = `
      <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; background: #fff; border: 1px solid #ddd;">
        <div style="background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">🔔 New Order Received</h1>
          <p style="color: #fecaca; margin: 10px 0 0 0;">Order ID: ${orderId}</p>
        </div>

        <div style="padding: 30px;">
          <div style="background: #fef2f2; border-left: 4px solid #dc2626; padding: 15px; margin-bottom: 25px;">
            <h2 style="margin: 0 0 10px 0; color: #dc2626;">Order Information</h2>
            <p style="margin: 5px 0; color: #666;">
              <strong>Order Date:</strong> ${formattedDate}<br>
              <strong>Payment Method:</strong> ${paymentMethod === "credit-card" ? "Credit Card" : "Bank Transfer"}<br>
              <strong>Total Amount:</strong> $${total.toFixed(2)} USD
            </p>
          </div>

          <h3 style="color: #dc2626; border-bottom: 2px solid #ef4444; padding-bottom: 10px;">Customer Information</h3>
          <table style="width: 100%; margin-bottom: 25px; background: #f9fafb; padding: 15px;">
            <tr>
              <td style="padding: 5px 0; width: 30%;"><strong>Name:</strong></td>
              <td style="padding: 5px 0;">${customer.name}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0;"><strong>Email:</strong></td>
              <td style="padding: 5px 0;"><a href="mailto:${customer.email}" style="color: #0d9488;">${customer.email}</a></td>
            </tr>
            <tr>
              <td style="padding: 5px 0;"><strong>Phone:</strong></td>
              <td style="padding: 5px 0;"><a href="tel:${customer.phone}" style="color: #0d9488;">${customer.phone}</a></td>
            </tr>
            <tr>
              <td style="padding: 5px 0; vertical-align: top;"><strong>Shipping Address:</strong></td>
              <td style="padding: 5px 0;">${customer.address}<br>${[customer.city, customer.zone, customer.zipCode].filter(Boolean).join(", ")}</td>
            </tr>
            ${customer.notes ? `
            <tr>
              <td style="padding: 5px 0; vertical-align: top;"><strong>Customer Notes:</strong></td>
              <td style="padding: 5px 0; background: #fffbeb; padding: 10px; border-radius: 4px;">${customer.notes}</td>
            </tr>
            ` : ""}
          </table>

          <h3 style="color: #dc2626; border-bottom: 2px solid #ef4444; padding-bottom: 10px;">Order Items</h3>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
            <thead>
              <tr style="background: #dc2626; color: white;">
                <th style="padding: 12px; text-align: left;">Product</th>
                <th style="padding: 12px; text-align: center; width: 80px;">Qty</th>
                <th style="padding: 12px; text-align: right; width: 100px;">Price</th>
                <th style="padding: 12px; text-align: right; width: 100px;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHTML}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3" style="padding: 15px; text-align: right; border: 1px solid #ddd; border-top: 2px solid #dc2626;"><strong>Subtotal:</strong></td>
                <td style="padding: 15px; text-align: right; border: 1px solid #ddd; border-top: 2px solid #dc2626;"><strong>$${subtotal.toFixed(2)}</strong></td>
              </tr>
              <tr>
                <td colspan="3" style="padding: 15px; text-align: right; background: #fef2f2; border: 1px solid #ddd; font-size: 18px;"><strong>Total:</strong></td>
                <td style="padding: 15px; text-align: right; background: #fef2f2; border: 1px solid #ddd; font-size: 18px; color: #dc2626;"><strong>$${total.toFixed(2)} USD</strong></td>
              </tr>
            </tfoot>
          </table>

          <div style="background: #dbeafe; border-left: 4px solid #3b82f6; padding: 15px; margin: 25px 0;">
            <h4 style="margin: 0 0 10px 0; color: #1e40af;">Action Required</h4>
            <p style="margin: 5px 0; color: #1e3a8a;">
              ✓ Contact customer to confirm order<br>
              ✓ Send payment instructions<br>
              ✓ Prepare shipping arrangements
            </p>
          </div>
        </div>
      </div>
    `;

    // Send email to customer
    await transporter.sendMail({
      from: `"Asian Import Export Co" <${process.env.SMTP_USER}>`,
      to: customer.email,
      subject: `Order Confirmation - ${orderId}`,
      html: customerEmailHTML,
    });

    // Send email to sales (admin)
    await transporter.sendMail({
      from: `"Website Orders" <${process.env.SMTP_USER}>`,
      to: SALES_EMAIL,
      subject: `🔔 New Order Received - ${orderId} - $${total.toFixed(2)}`,
      html: adminEmailHTML,
    });

    res.status(200).json({ 
      success: true, 
      orderId,
      message: "Invoice sent successfully" 
    });
  } catch (error) {
    console.error("Error sending invoice:", error);
    res.status(500).json({ error: "Failed to send invoice" });
  }
});

// Server
const PORT = process.env.PORT || 5000;

if (process.env.VERCEL !== "1") {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
