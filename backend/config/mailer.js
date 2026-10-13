import nodemailer from "nodemailer";

let transporter = null;
let isTestAccount = false;

const getSmtpConfig = () => {
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    SMTP_SECURE,
    EMAIL_FROM,
  } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !EMAIL_FROM) {
    if (process.env.NODE_ENV !== "production") {
      return null;
    }

    throw new Error(
      "Missing SMTP environment variables. Please set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and EMAIL_FROM."
    );
  }

  const portNumber = Number(SMTP_PORT);
  const secure = portNumber === 465;
  const requireTLS = portNumber === 587;

  return {
    host: SMTP_HOST,
    port: portNumber,
    secure,
    requireTLS,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS.replace(/\s+/g, ""),
    },
    tls: {
      rejectUnauthorized: false,
    },
  };
};

const createTransporter = async () => {
  if (transporter) {
    return transporter;
  }

  const smtpConfig = getSmtpConfig();
  if (smtpConfig) {
    transporter = nodemailer.createTransport({
      ...smtpConfig,
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 60000,
    });
  } else {
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    isTestAccount = true;
    console.info("SMTP config missing; using Nodemailer test account for development.");
  }

  return transporter;
};

export const sendMail = async (mailOptions) => {
  const transport = await createTransporter();

  try {
    const result = await transport.sendMail(mailOptions);

    if (isTestAccount) {
      const previewUrl = nodemailer.getTestMessageUrl(result);
      if (previewUrl) {
        console.info("Test email preview URL:", previewUrl);
      }
    }

    return result;
  } catch (error) {
    console.error("Primary SMTP send failed:", error);

    // Do not silently route real customer mail to Ethereal when configured SMTP
    // credentials are invalid. That makes the API look successful while the
    // customer receives nothing.
    if (process.env.NODE_ENV !== "production" && !isTestAccount && !process.env.SMTP_HOST) {
      console.warn("Primary mail transport failed; falling back to Nodemailer test account for development email.");
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
      isTestAccount = true;

      const result = await transporter.sendMail(mailOptions);
      const previewUrl = nodemailer.getTestMessageUrl(result);
      if (previewUrl) {
        console.info("Fallback test email preview URL:", previewUrl);
      }
      return result;
    }

    throw error;
  }
};
