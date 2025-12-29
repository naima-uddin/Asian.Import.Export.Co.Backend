require("dotenv").config();
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

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

  // Nodemailer transporter with Hostinger SMTP
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.hostinger.com",
    port: parseInt(process.env.SMTP_PORT) || 465,
    secure: true, // use SSL
    auth: {
      user: process.env.SMTP_USER || process.env.OWNER_EMAIL,
      pass: process.env.SMTP_PASSWORD,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

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

    await transporter.sendMail({
      from: `"Product Inquiry" <${process.env.SMTP_USER}>`,
      to: type === "product_inquiry" ? "sale@asianimportexport.com" : "info@asianimportexport.com",
      subject: emailSubject,
      text: textContent,
      html: htmlContent,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error sending email:", error);
    res.status(500).json({ error: "Failed to send email" });
  }
});

// Invoice email endpoint for cart orders
app.post("/api/send-invoice", async (req, res) => {
  const { customer, items, subtotal, total, orderDate, paymentMethod } = req.body;

  // Nodemailer transporter
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.hostinger.com",
    port: parseInt(process.env.SMTP_PORT) || 465,
    secure: true,
    auth: {
      user: process.env.SMTP_USER || process.env.OWNER_EMAIL,
      pass: process.env.SMTP_PASSWORD,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

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
              <td style="padding: 5px 0;">${customer.address}<br>${customer.city}, ${customer.state} ${customer.zipCode}</td>
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
              <td style="padding: 5px 0;">${customer.address}<br>${customer.city}, ${customer.state} ${customer.zipCode}</td>
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
      to: "sale@asianimportexport.com",
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
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
