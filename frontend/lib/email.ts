import { Resend } from "resend";

const DEFAULT_EMAIL_FROM = "Cerul <noreply@cerul.ai>";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
};

function getEmailFromAddress(): string {
  const configuredFrom = process.env.EMAIL_FROM?.trim();
  return configuredFrom || DEFAULT_EMAIL_FROM;
}

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  return new Resend(apiKey);
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const resend = getResendClient();

  if (!resend) {
    console.warn("[email] RESEND_API_KEY not set; skipping transactional email.");
    console.log(`[email] Would have sent to ${input.to}: ${input.subject}`);
    return;
  }

  await resend.emails.send({
    from: getEmailFromAddress(),
    to: input.to,
    subject: input.subject,
    html: input.html,
  });
}
