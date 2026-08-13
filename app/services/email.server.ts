import nodemailer from "nodemailer";

const smtpPort = Number(process.env.SMTP_PORT || 587);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: smtpPort,
  secure: smtpPort === 465,
  requireTLS: smtpPort === 587,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

type SendEmailArgs = {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  fromName?: string;
  fromAddress?: string;
  replyTo?: string;
};

export async function sendEmail({
  to,
  subject,
  text,
  html,
  fromName,
  fromAddress,
  replyTo,
}: SendEmailArgs) {
  const name =
    fromName ||
    process.env.MAIL_FROM_NAME ||
    "DH Conversions";

  const address =
    fromAddress ||
    process.env.MAIL_FROM_ADDRESS ||
    "info@app.datahatches.com";

  return transporter.sendMail({
    from: `"${name}" <${address}>`,
    to,
    subject,
    text,
    html,
    ...(replyTo ? { replyTo } : {}),
  });
}

export async function verifyEmailTransport() {
  return transporter.verify();
}
