function getResendApiKey(): string {
  return process.env.RESEND_API_KEY || "";
}

function getResendFromEmail(): string {
  return process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
}

function getAppName(): string {
  return process.env.APP_NAME || "Keryx";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function assertInvitationUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid invitation URL");
  }

  if (!/^https?:$/.test(url.protocol)) {
    throw new Error("Invalid invitation URL");
  }

  if (!url.pathname.startsWith("/invite/")) {
    throw new Error("Invalid invitation URL");
  }

  return url;
}

export async function sendInvitationEmail(params: {
  email: string;
  invitationUrl: string;
  role: "admin" | "user";
}): Promise<{ id?: string }> {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  const email = params.email.trim().toLowerCase();
  if (!email) {
    throw new Error("Missing invitation email");
  }

  const invitationUrl = assertInvitationUrl(
    params.invitationUrl.trim(),
  ).toString();
  const appName = getAppName();
  const roleLabel = params.role === "admin" ? "administrator" : "user";
  const escapedAppName = escapeHtml(appName);
  const escapedInvitationUrl = escapeHtml(invitationUrl);
  const escapedEmail = escapeHtml(email);
  const escapedRoleLabel = escapeHtml(roleLabel);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: getResendFromEmail(),
      to: [email],
      subject: `You have been invited to ${appName}`,
      html: `
        <div>
          <p>You have been invited to join <strong>${escapedAppName}</strong> as a <strong>${escapedRoleLabel}</strong>.</p>
          <p><a href="${escapedInvitationUrl}">Accept invitation</a></p>
          <p>If the button does not work, copy and paste this link into your browser:</p>
          <p>${escapedInvitationUrl}</p>
          <p>This invitation was issued for ${escapedEmail}.</p>
        </div>
      `,
      text: [
        `You have been invited to join ${appName} as a ${roleLabel}.`,
        "",
        "Accept invitation:",
        invitationUrl,
        "",
        `This invitation was issued for ${email}.`,
      ].join("\n"),
    }),
  });

  const payload = (await response.json().catch(() => null)) as {
    id?: string;
    message?: string;
    error?: string | { message?: string };
  } | null;

  if (!response.ok) {
    const message =
      typeof payload?.message === "string"
        ? payload.message
        : typeof payload?.error === "string"
          ? payload.error
          : typeof payload?.error?.message === "string"
            ? payload.error.message
            : "Unable to send invitation email";
    throw new Error(message);
  }

  return { id: payload?.id };
}
