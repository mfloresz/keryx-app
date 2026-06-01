"use server";

import { z } from "zod";
import { createSession } from "./auth";
import { authenticateUser, registerUserFromInvite } from "@/lib/db/queries";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const inviteRegistrationSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

export type LoginActionState = {
  status: "idle" | "in_progress" | "success" | "failed" | "invalid_data";
};

export const login = async (
  _: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> => {
  try {
    const validatedData = loginSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

    const session = await authenticateUser(
      validatedData.email,
      validatedData.password,
    );

    await createSession(session);

    return { status: "success" };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: "invalid_data" };
    }

    return { status: "failed" };
  }
};

export type RegisterActionState = {
  status:
    | "idle"
    | "in_progress"
    | "success"
    | "failed"
    | "invalid_data"
    | "invite_invalid"
    | "invite_expired"
    | "invite_used";
};

export const register = async (
  _: RegisterActionState,
  formData: FormData,
): Promise<RegisterActionState> => {
  try {
    const validatedData = inviteRegistrationSchema.parse({
      token: formData.get("token"),
      password: formData.get("password"),
    });

    const result = await registerUserFromInvite({
      token: validatedData.token,
      password: validatedData.password,
    });

    await createSession(result.session);

    return { status: "success" };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: "invalid_data" };
    }

    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (message.includes("expired")) {
        return { status: "invite_expired" };
      }

      if (message.includes("used")) {
        return { status: "invite_used" };
      }
    }

    return { status: "invite_invalid" };
  }
};
