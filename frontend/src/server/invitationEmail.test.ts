import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendInvitationEmail } from "./invitationEmail.js";

describe("sendInvitationEmail", () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFromEmail = process.env.RESEND_FROM_EMAIL;
  const originalAppName = process.env.APP_NAME;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.RESEND_API_KEY = "";
    process.env.RESEND_FROM_EMAIL = "";
    process.env.APP_NAME = "Keryx";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.RESEND_API_KEY = originalApiKey;
    process.env.RESEND_FROM_EMAIL = originalFromEmail;
    process.env.APP_NAME = originalAppName;
  });

  it("throws when the Resend API key is not configured", async () => {
    await expect(
      sendInvitationEmail({
        email: "user@example.com",
        invitationUrl: "https://keryx.test/invite/token-123",
        role: "user",
      }),
    ).rejects.toThrow("RESEND_API_KEY is not configured");
  });

  it("sends the invitation email through the Resend API", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "hello@example.com";
    process.env.APP_NAME = "Keryx Cloud";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "email_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock;

    const result = await sendInvitationEmail({
      email: "USER@example.com ",
      invitationUrl: "https://keryx.test/invite/token-123",
      role: "admin",
    });

    expect(result).toEqual({ id: "email_123" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer re_test_key",
          "content-type": "application/json",
        }),
      }),
    );

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body));
    expect(body).toMatchObject({
      from: "hello@example.com",
      to: ["user@example.com"],
      subject: "You have been invited to Keryx Cloud",
    });
    expect(body.html).toContain("https://keryx.test/invite/token-123");
    expect(body.text).toContain("administrator");
  });

  it("rejects malformed invitation URLs", async () => {
    process.env.RESEND_API_KEY = "re_test_key";

    await expect(
      sendInvitationEmail({
        email: "user@example.com",
        invitationUrl: "javascript:alert(1)",
        role: "user",
      }),
    ).rejects.toThrow("Invalid invitation URL");
  });
});
