import {
  streamText,
  convertToModelMessages,
  generateText,
  stepCountIs,
  type UIMessage,
} from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { createGatewayProvider } from "@ai-sdk/gateway";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  createTavilyExtractTool,
  createTavilySearchTool,
  parseTavilyOptions,
} from "../utils/tavilyTools.js";
import { getModels } from "../shared/utils/models.js";
import {
  BASE_SYSTEM_PROMPT,
  TITLE_GENERATION_SYSTEM_PROMPT,
} from "../shared/prompts.js";
import {
  annotateBranchMetadata,
  cloneJson,
  getFirstUnsupportedCloudAttachmentUrl,
  normalizeMessageAttachments,
  openNewBranch,
  prepareMessagesForModel,
  sanitizeMessagesForStorage,
  syncCurrentBranchSnapshots,
  upsertUserMessage,
} from "../shared/chatCore.js";
import { getChatStorage } from "./cloudStore.js";
import {
  countAdmins,
  createInvitation,
  deleteInvitation,
  getInvitationByTokenHash,
  getUserByEmail,
  getUserById,
  listInvitations,
  listModels,
  listUsers,
  markInvitationUsed,
  setModelEnabled,
  updateUserRole,
  upsertUser,
  type AppInvitationRecord,
} from "./appStore.js";
import { requireAdmin, requireUser } from "./authz.js";
import { ensureBootstrapAdmin } from "./bootstrapAdmin.js";
import {
  assertModelAllowed,
  getAllManagedModels,
  getAllowedModels,
} from "./modelAccess.js";
import { createSupabaseUser, updateSupabaseUserRole } from "./supabaseAdmin.js";
import { sendInvitationEmail } from "./invitationEmail.js";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ message }, status);
}

function getGatewayApiKey(): string {
  return (
    process.env.AI_GATEWAY_API_KEY ||
    process.env.VERCEL_AI_GATEWAY_API_KEY ||
    ""
  );
}

function getOpenCodeApiKey(): string {
  return process.env.OPENCODE_API_KEY || "";
}

function getCloudProvider(model: string) {
  if (model.startsWith("opencode/")) {
    const apiKey = getOpenCodeApiKey();
    if (!apiKey) {
      throw new Error("OpenCode API key not configured");
    }
    return createOpenAICompatible({
      name: "opencode",
      apiKey,
      baseURL: "https://opencode.ai/zen/go/v1",
    });
  }

  const apiKey = getGatewayApiKey();
  if (!apiKey) {
    throw new Error("AI Gateway API key not configured");
  }

  return createGatewayProvider({
    apiKey,
    baseURL: "https://ai-gateway.vercel.sh/v3/ai",
  });
}

function getResolvedModelId(model: string): string {
  if (model.startsWith("opencode/")) {
    return model.split("/")[1] ?? model;
  }
  return model;
}

function countToolParts(messages: UIMessage[]): number {
  return messages.reduce((total, message) => {
    if (!Array.isArray((message as any).parts)) {
      return total;
    }

    return (
      total +
      (message as any).parts.filter((part: any) => {
        return typeof part?.type === "string" && part.type.includes("tool");
      }).length
    );
  }, 0);
}

async function generateCloudChatTitle(
  chatId: string,
  userMsg: UIMessage,
  ownerId: string,
) {
  try {
    const provider = getCloudProvider("openai/gpt-5.4-nano");
    const { text: title } = await generateText({
      model: provider("mistral/ministral-8b"),
      system: TITLE_GENERATION_SYSTEM_PROMPT,
      prompt: JSON.stringify(userMsg),
    });

    const storage = await getChatStorage();
    await storage.updateGeneratedTitle(chatId, ownerId, title);
  } catch {
    // ignore title generation failures
  }
}

function isNativeWebSearchEnabled(
  model: string,
  webSearch: boolean,
  searchEngine: string,
): boolean {
  return (
    webSearch && searchEngine !== "tavily" && !model.startsWith("opencode/")
  );
}

function isTavilySearchEnabled(
  webSearch: boolean,
  searchEngine: string,
  tavilyApiKey: string,
): boolean {
  return (
    webSearch && searchEngine === "tavily" && tavilyApiKey.trim().length > 0
  );
}

function isInvitationValid(
  invitation: AppInvitationRecord | null,
): invitation is AppInvitationRecord {
  if (!invitation) return false;
  if (invitation.usedAt) return false;
  return true;
}

async function sha256(input: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getBaseUrl(request: Request): string {
  return (
    process.env.APP_BASE_URL?.replace(/\/$/, "") || new URL(request.url).origin
  );
}

async function readJsonBody<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}

function sanitizeInvitation(invitation: AppInvitationRecord) {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    usedAt: invitation.usedAt,
    createdBy: invitation.createdBy,
    createdAt: invitation.createdAt,
    initialModelAccess: invitation.initialModelAccess,
  };
}

async function handleAuthMe(request: Request): Promise<Response> {
  const user = await requireUser(request);
  return jsonResponse({
    id: user.id,
    email: user.email,
    role: user.role,
  });
}

async function handleInvitationValidate(request: Request): Promise<Response> {
  const body = await readJsonBody<{ token?: string }>(request);
  if (!body.token) {
    return errorResponse("Missing token", 400);
  }

  const invitation = await getInvitationByTokenHash(await sha256(body.token));
  if (!isInvitationValid(invitation)) {
    return jsonResponse({ valid: false }, 200);
  }

  return jsonResponse({
    valid: true,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    modelIds: invitation.initialModelAccess,
  });
}

async function handleInvitationAccept(request: Request): Promise<Response> {
  const body = await readJsonBody<{ token?: string; password?: string }>(
    request,
  );
  const token = body.token?.trim();
  const password = body.password?.trim();

  if (!token || !password) {
    return errorResponse("Missing invitation token or password", 400);
  }

  if (password.length < 8) {
    return errorResponse("Password must be at least 8 characters", 400);
  }

  const invitation = await getInvitationByTokenHash(await sha256(token));
  if (!isInvitationValid(invitation)) {
    return errorResponse("Invitation is invalid or expired", 400);
  }

  const existingUser = await getUserByEmail(invitation.email);
  if (existingUser) {
    return errorResponse("A user with this email already exists", 409);
  }

  const createdUser = await createSupabaseUser({
    email: invitation.email,
    password,
    role: invitation.role,
  });

  const now = new Date().toISOString();
  await upsertUser({
    id: createdUser.id,
    email: invitation.email,
    role: invitation.role,
    createdAt: now,
    updatedAt: now,
  });

  await markInvitationUsed(invitation.id, now);

  return jsonResponse({
    success: true,
    email: invitation.email,
  });
}

async function handleAdminListUsers(request: Request): Promise<Response> {
  await requireAdmin(request);
  return jsonResponse(await listUsers());
}

async function handleAdminUpdateUserRole(
  request: Request,
  userId: string,
): Promise<Response> {
  await requireAdmin(request);
  const body = await readJsonBody<{ role?: "admin" | "user" }>(request);
  const nextRole =
    body.role === "admin" ? "admin" : body.role === "user" ? "user" : null;
  if (!nextRole) {
    return errorResponse("Missing role", 400);
  }

  const user = await getUserById(userId);
  if (!user) {
    return errorResponse("User not found", 404);
  }

  if (user.role === "admin" && nextRole === "user") {
    const adminCount = await countAdmins();
    if (adminCount <= 1) {
      return errorResponse("At least one admin user is required", 400);
    }
  }

  await updateSupabaseUserRole({ userId, role: nextRole });
  await updateUserRole(userId, nextRole);

  return jsonResponse({ success: true });
}

async function handleAdminListModels(request: Request): Promise<Response> {
  await requireAdmin(request);
  return jsonResponse(await listModels());
}

async function handleAdminUpdateModel(
  request: Request,
  modelId: string,
): Promise<Response> {
  await requireAdmin(request);
  const body = await readJsonBody<{ enabled?: boolean }>(request);
  if (typeof body.enabled !== "boolean") {
    return errorResponse("Missing enabled flag", 400);
  }
  await setModelEnabled(modelId, body.enabled);
  return jsonResponse({ success: true });
}

async function handleAdminListInvitations(request: Request): Promise<Response> {
  await requireAdmin(request);
  const invitations = await listInvitations();
  return jsonResponse(invitations.map(sanitizeInvitation));
}

async function handleAdminCreateInvitation(
  request: Request,
): Promise<Response> {
  const admin = await requireAdmin(request);
  const body = await readJsonBody<{
    email?: string;
    role?: "admin" | "user";
  }>(request);

  const email = body.email?.trim().toLowerCase();
  if (!email) {
    return errorResponse("Missing invitation email", 400);
  }

  const existingUser = await getUserByEmail(email);
  if (existingUser) {
    return errorResponse("A user with this email already exists", 409);
  }

  const rawToken = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const now = new Date();
  const invitation: AppInvitationRecord = {
    id: crypto.randomUUID(),
    email,
    tokenHash: await sha256(rawToken),
    role: body.role === "admin" ? "admin" : "user",
    expiresAt: "9999-12-31T23:59:59.999Z",
    usedAt: null,
    createdBy: admin.id,
    createdAt: now.toISOString(),
    initialModelAccess: [],
  };

  await createInvitation(invitation);

  return jsonResponse({
    invitation: sanitizeInvitation(invitation),
    invitationUrl: `${getBaseUrl(request)}/invite/${rawToken}`,
  });
}

async function handleAdminSendInvitationEmail(
  request: Request,
): Promise<Response> {
  await requireAdmin(request);
  const body = await readJsonBody<{
    email?: string;
    invitationUrl?: string;
    role?: "admin" | "user";
  }>(request);

  const email = body.email?.trim().toLowerCase();
  const invitationUrl = body.invitationUrl?.trim();
  if (!email || !invitationUrl) {
    return errorResponse("Missing invitation email or URL", 400);
  }

  await sendInvitationEmail({
    email,
    invitationUrl,
    role: body.role === "admin" ? "admin" : "user",
  });

  return jsonResponse({ success: true });
}

async function handleAdminDeleteInvitation(
  request: Request,
  invitationId: string,
): Promise<Response> {
  await requireAdmin(request);
  await deleteInvitation(invitationId);
  return jsonResponse({ success: true });
}

async function handleChatRoutes(
  request: Request,
  url: URL,
  method: string,
): Promise<Response | null> {
  const currentUser = await requireUser(request);
  const ownerId = currentUser.id;
  const storage = await getChatStorage();

  if (url.pathname === "/api/favorites" && method === "GET") {
    return jsonResponse(await storage.listFavorites(ownerId));
  }

  if (url.pathname === "/api/chats" && method === "GET") {
    return jsonResponse(await storage.listChats(ownerId));
  }

  if (url.pathname === "/api/chats" && method === "DELETE") {
    await storage.deleteAllChats(ownerId);
    return jsonResponse({ success: true });
  }

  if (url.pathname === "/api/chats" && method === "POST") {
    const body: any = await request.json();
    if (!body?.id) {
      return errorResponse("Missing chat id", 400);
    }
    await storage.saveChat(body, ownerId);
    return jsonResponse({ success: true });
  }

  const streamChatId = url.pathname.match(
    /^\/api\/chats\/([^/]+)\/stream$/,
  )?.[1];
  const chatId = url.pathname.match(/^\/api\/chats\/([^/]+)$/)?.[1];
  if (chatId && method === "GET") {
    const chat = await storage.getChat(chatId, ownerId);
    if (!chat) return errorResponse("Chat not found", 404);
    return jsonResponse({ ...annotateBranchMetadata(chat), isOwner: true });
  }

  if (chatId && method === "DELETE") {
    await storage.deleteChat(chatId, ownerId);
    return jsonResponse({ success: true });
  }

  const titleChatId = url.pathname.match(/^\/api\/chats\/title\/([^/]+)$/)?.[1];
  if (titleChatId && method === "PATCH") {
    const body: any = await request.json();
    const chat = await storage.updateTitle(
      titleChatId,
      ownerId,
      body.title ?? null,
    );
    if (!chat) return errorResponse("Chat not found", 404);
    return jsonResponse(chat);
  }

  const visibilityChatId = url.pathname.match(
    /^\/api\/chats\/visibility\/([^/]+)$/,
  )?.[1];
  if (visibilityChatId && method === "PATCH") {
    const body: any = await request.json();
    const chat = await storage.updateVisibility(
      visibilityChatId,
      ownerId,
      body.visibility,
    );
    if (!chat) return errorResponse("Chat not found", 404);
    return jsonResponse(chat);
  }

  const messagesChatId = url.pathname.match(
    /^\/api\/chats\/messages\/([^/]+)$/,
  )?.[1];
  if (messagesChatId && method === "DELETE") {
    const body: any = await request.json();
    const chat = await storage.getChat(messagesChatId, ownerId);
    if (!chat) return errorResponse("Chat not found", 404);

    const targetIndex = chat.messages.findIndex(
      (message: UIMessage) => message.id === body.messageId,
    );
    if (targetIndex === -1) return errorResponse("Message not found", 404);

    const targetRole = chat.messages[targetIndex]!.role;
    if (body.type === "edit" && targetRole !== "user") {
      return errorResponse("Can only edit user messages", 400);
    }
    if (body.type === "regenerate" && targetRole !== "assistant") {
      return errorResponse("Can only regenerate assistant messages", 400);
    }

    if (body.type === "regenerate") {
      const parentMessage = chat.messages[targetIndex - 1];
      const hasUserParent = parentMessage?.role === "user";
      const rootMessageId = hasUserParent ? parentMessage.id : body.messageId;
      const includeRoot = !hasUserParent;
      openNewBranch(
        chat,
        rootMessageId,
        includeRoot,
        targetIndex,
        "Regeneration",
      );
      chat.messages = chat.messages.slice(0, targetIndex);
    } else {
      openNewBranch(chat, body.messageId, true, targetIndex, "Edit");
      chat.messages = chat.messages.slice(0, targetIndex + 1);
    }

    syncCurrentBranchSnapshots(chat);
    await storage.saveChatContent(chat, ownerId);
    return jsonResponse({ success: true });
  }

  const branchesChatId = url.pathname.match(
    /^\/api\/chats\/branches\/([^/]+)$/,
  )?.[1];
  if (branchesChatId && method === "POST") {
    const body: any = await request.json();
    const { rootMessageId, snapshotId } = body || {};
    if (!rootMessageId || !snapshotId) {
      return errorResponse("Missing branch selection payload", 400);
    }

    const chat = await storage.getChat(branchesChatId, ownerId);
    if (!chat) return errorResponse("Chat not found", 404);

    const branchState = chat.branches?.[rootMessageId];
    if (!branchState) return errorResponse("Branch not found", 404);

    syncCurrentBranchSnapshots(chat);
    const snapshot = branchState.snapshots.find(
      (item: { id: string }) => item.id === snapshotId,
    );
    if (!snapshot) return errorResponse("Snapshot not found", 404);

    const rootIndex = chat.messages.findIndex(
      (message: UIMessage) => message.id === rootMessageId,
    );
    if (rootIndex === -1) return errorResponse("Branch root not found", 404);

    const startIndex = branchState.includeRoot ? rootIndex : rootIndex + 1;
    chat.messages = [
      ...chat.messages.slice(0, startIndex),
      ...cloneJson(snapshot.messages),
    ];
    branchState.currentSnapshotId = snapshot.id;
    syncCurrentBranchSnapshots(chat);
    await storage.saveChatContent(chat, ownerId);
    return jsonResponse({ ...annotateBranchMetadata(chat), isOwner: true });
  }

  const votesChatId = url.pathname.match(/^\/api\/chats\/votes\/([^/]+)$/)?.[1];
  if (votesChatId && method === "GET") {
    const chat = await storage.getChat(votesChatId, ownerId);
    if (!chat) return errorResponse("Chat not found", 404);
    return jsonResponse(chat.votes || []);
  }

  if (votesChatId && method === "POST") {
    const body: any = await request.json();
    const chat = await storage.getChat(votesChatId, ownerId);
    if (!chat) return errorResponse("Chat not found", 404);

    const targetMessage = chat.messages.find(
      (message: UIMessage) => message.id === body.messageId,
    );
    if (!targetMessage) return errorResponse("Message not found", 404);
    if (targetMessage.role !== "assistant") {
      return errorResponse("Can only vote on assistant messages", 400);
    }

    let votes = chat.votes || [];
    if (body.isUpvoted === undefined) {
      votes = votes.filter(
        (vote: { messageId: string }) => vote.messageId !== body.messageId,
      );
    } else {
      const existing = votes.find(
        (vote: { messageId: string }) => vote.messageId === body.messageId,
      );
      if (existing) {
        existing.isUpvoted = body.isUpvoted;
      } else {
        votes.push({
          chatId: chat.id,
          messageId: body.messageId,
          isUpvoted: body.isUpvoted,
        });
      }
    }
    chat.votes = votes;
    await storage.saveChatContent(chat, ownerId);
    return jsonResponse({
      chatId: chat.id,
      messageId: body.messageId,
      isUpvoted: body.isUpvoted,
    });
  }

  if ((chatId || streamChatId) && method === "POST") {
    const targetChatId = streamChatId || chatId;
    const chat = await storage.getChat(targetChatId!, ownerId);
    if (!chat) return errorResponse("Chat not found", 404);

    const body: any = await request.json();
    const { model, messages: rawMessages, webSearch } = body;
    const searchEngine =
      typeof body?.searchEngine === "string" ? body.searchEngine : "native";
    const tavilyApiKey =
      typeof body?.tavilyApiKey === "string" ? body.tavilyApiKey : "";
    const tavilyOptions = parseTavilyOptions(body?.tavilyOptions);
    const messages = normalizeMessageAttachments(rawMessages);

    console.info("[cloud-chat] incoming request", {
      chatId: targetChatId,
      model,
      webSearch: Boolean(webSearch),
      searchEngine,
      hasTavilyApiKey: tavilyApiKey.trim().length > 0,
      bodyKeys: Object.keys(body ?? {}),
      messageCount: Array.isArray(messages) ? messages.length : 0,
    });
    const unsupportedAttachmentUrl =
      getFirstUnsupportedCloudAttachmentUrl(messages);
    if (unsupportedAttachmentUrl) {
      return errorResponse(
        "Cloud mode only accepts inline data URLs for message attachments",
        400,
      );
    }
    const providerModels = getModels(
      model.startsWith("opencode/") ? "opencode" : "vercel",
    );
    if (!providerModels.some((item) => item.value === model)) {
      return errorResponse("Invalid model", 400);
    }
    await assertModelAllowed(ownerId, model);

    if (!chat.title && messages.length > 0) {
      const userMsg = messages.find(
        (message: UIMessage) => message.role === "user",
      );
      if (userMsg) {
        generateCloudChatTitle(targetChatId!, userMsg, ownerId).catch(() => {});
      }
    }

    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === "user") {
      const [sanitizedMessage] = sanitizeMessagesForStorage([lastMessage]);
      const didChange = upsertUserMessage(chat, sanitizedMessage);
      const didSearchChange = chat.webSearch !== Boolean(webSearch);
      chat.webSearch = Boolean(webSearch);
      if (didChange || didSearchChange) {
        syncCurrentBranchSnapshots(chat);
        await storage.saveChatContent(chat, ownerId);
      }
    }

    const provider = getCloudProvider(model);
    const isAnthropic = model.startsWith("anthropic/");
    const tools: Record<string, any> = {};
    const tavilyEnabled = isTavilySearchEnabled(
      Boolean(webSearch),
      searchEngine,
      tavilyApiKey,
    );
    const nativeWebSearchEnabled = isNativeWebSearchEnabled(
      model,
      Boolean(webSearch),
      searchEngine,
    );

    if (tavilyEnabled) {
      tools.tavily_search = createTavilySearchTool({
        apiKey: tavilyApiKey,
        options: tavilyOptions,
      });
      tools.tavily_extract = createTavilyExtractTool({
        apiKey: tavilyApiKey,
      });
    } else if (nativeWebSearchEnabled) {
      if (isAnthropic) {
        tools.web_search = anthropic.tools.webSearch_20250305();
      } else if (model.startsWith("openai/")) {
        tools.web_search = openai.tools.webSearch();
      }
    }

    const webResearchEnabled = tavilyEnabled || nativeWebSearchEnabled;

    console.info("[cloud-chat] tool selection", {
      chatId: targetChatId,
      model,
      webSearch: Boolean(webSearch),
      searchEngine,
      tavilyEnabled,
      nativeWebSearchEnabled,
      selectedTools: Object.keys(tools),
    });

    let systemPrompt = BASE_SYSTEM_PROMPT;
    if (webResearchEnabled) {
      systemPrompt += `

---

VII. Web Research

Web research is enabled for this conversation. Do not claim that you lack internet access or browsing/search capability when research tools are available. Use the available web research tool whenever the user asks for current, time-sensitive, or externally verifiable information, and cite the sources you use by referencing their URLs.`;
    }
    if (tavilyEnabled) {
      systemPrompt += `

You have access to two web research tools: tavily_search and tavily_extract.
- Use tavily_search to find current and relevant information on the web. Provide a clear, specific query to get the best results.
- Use tavily_extract when you need to retrieve detailed raw content from specific URLs found via search or provided by the user.
- When a user asks about current events, recent data, or anything that may have changed after your training cutoff, you MUST use tavily_search.`;
    }

    const resolvedModel = getResolvedModelId(model);
    const result = streamText({
      model: provider(resolvedModel),
      system: systemPrompt,
      messages: await convertToModelMessages(
        await prepareMessagesForModel(messages, model),
      ),
      tools,
      ...(!isAnthropic ? { stopWhen: stepCountIs(5) } : {}),
    });

    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      onFinish: async ({ messages: finishedMessages }) => {
        const totalUsage = await result.totalUsage;

        console.info("[cloud-chat] stream finished", {
          chatId: targetChatId,
          model,
          selectedTools: Object.keys(tools),
          toolPartCount: countToolParts(finishedMessages),
          usage: totalUsage,
        });

        const latestChat = await storage.getChat(targetChatId!, ownerId);
        if (!latestChat) return;
        latestChat.messages = sanitizeMessagesForStorage(finishedMessages);
        latestChat.lastUsage = totalUsage;
        syncCurrentBranchSnapshots(latestChat);
        await storage.saveChatContent(latestChat, ownerId);
      },
    });
  }

  return null;
}

export async function handleApiRequest(
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  try {
    await ensureBootstrapAdmin();
    if (url.pathname === "/api/auth/me" && method === "GET") {
      return await handleAuthMe(request);
    }

    if (url.pathname === "/api/invitations/validate" && method === "POST") {
      return await handleInvitationValidate(request);
    }

    if (url.pathname === "/api/invitations/accept" && method === "POST") {
      return await handleInvitationAccept(request);
    }

    if (url.pathname === "/api/models/allowed" && method === "GET") {
      const user = await requireUser(request);
      return jsonResponse(await getAllowedModels(user.id));
    }

    if (url.pathname === "/api/admin/users" && method === "GET") {
      return await handleAdminListUsers(request);
    }

    const adminUserId = url.pathname.match(
      /^\/api\/admin\/users\/([^/]+)$/,
    )?.[1];
    if (adminUserId && method === "PATCH") {
      return await handleAdminUpdateUserRole(
        request,
        decodeURIComponent(adminUserId),
      );
    }

    if (url.pathname === "/api/admin/models" && method === "GET") {
      return await handleAdminListModels(request);
    }

    const adminModelId = url.pathname.match(
      /^\/api\/admin\/models\/([^/]+)$/,
    )?.[1];
    if (adminModelId && method === "PATCH") {
      return await handleAdminUpdateModel(
        request,
        decodeURIComponent(adminModelId),
      );
    }

    if (url.pathname === "/api/admin/invitations" && method === "GET") {
      return await handleAdminListInvitations(request);
    }

    if (url.pathname === "/api/admin/invitations" && method === "POST") {
      return await handleAdminCreateInvitation(request);
    }

    if (url.pathname === "/api/admin/invitations/send" && method === "POST") {
      return await handleAdminSendInvitationEmail(request);
    }

    const adminInvitationId = url.pathname.match(
      /^\/api\/admin\/invitations\/([^/]+)$/,
    )?.[1];
    if (adminInvitationId && method === "DELETE") {
      return await handleAdminDeleteInvitation(
        request,
        decodeURIComponent(adminInvitationId),
      );
    }

    if (url.pathname === "/api/admin/models/catalog" && method === "GET") {
      await requireAdmin(request);
      return jsonResponse(await getAllManagedModels());
    }

    if (
      url.pathname.startsWith("/api/chats") ||
      url.pathname.startsWith("/api/favorites")
    ) {
      return await handleChatRoutes(request, url, method);
    }

    return null;
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    const message = error instanceof Error ? error.message : "Internal error";
    return errorResponse(message, 500);
  }
}
