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
      to: process.env.OWNER_EMAIL,
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

// Server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
