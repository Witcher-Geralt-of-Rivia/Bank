"use server";

import { z } from "zod";
import { reasonSchema, roleSchema } from "@/lib/validation";
import { setAccountStatus, setUserRole, setUserStatus } from "../admin/service";
import {
  approveTransfer,
  failTransfer,
  rejectTransfer,
  reverseTransaction,
  settleTransfer,
} from "../ledger/service";
import { defineAction } from "./define";

/**
 * Operations console actions. The role list on each action is the first
 * check; the domain services enforce the same rules again, so a mistake in
 * either layer alone cannot grant access.
 */

const STAFF = ["operator", "admin"] as const;
const ADMIN = ["admin"] as const;

const id = z.string().min(4).max(64);
const optionalNote = z.string().trim().max(280).optional();

export const approveTransferAction = defineAction(
  { roles: STAFF, schema: z.object({ id, note: optionalNote }) },
  async (input, { db, ctx }) => {
    const updated = await approveTransfer(db, ctx, input.id, input.note);
    return { status: updated.status };
  },
);

export const rejectTransferAction = defineAction(
  { roles: STAFF, schema: z.object({ id, reason: reasonSchema }) },
  async (input, { db, ctx }) => {
    const updated = await rejectTransfer(db, ctx, input.id, input.reason);
    return { status: updated.status };
  },
);

export const settleTransferAction = defineAction(
  { roles: STAFF, schema: z.object({ id, note: optionalNote }) },
  async (input, { db, ctx }) => {
    const updated = await settleTransfer(db, ctx, input.id, input.note);
    return { status: updated.status };
  },
);

export const failTransferAction = defineAction(
  { roles: STAFF, schema: z.object({ id, reason: reasonSchema }) },
  async (input, { db, ctx }) => {
    const updated = await failTransfer(db, ctx, input.id, input.reason);
    return { status: updated.status };
  },
);

export const reverseTransactionAction = defineAction(
  { roles: ADMIN, schema: z.object({ id, reason: reasonSchema }) },
  async (input, { db, ctx }) => {
    const { reversal } = await reverseTransaction(db, ctx, input.id, input.reason);
    return { reversalId: reversal.id, reversalReference: reversal.reference };
  },
);

export const setAccountStatusAction = defineAction(
  { roles: STAFF, schema: z.object({ id, status: z.enum(["active", "frozen"]), reason: reasonSchema }) },
  async (input, { db, ctx }) => {
    await setAccountStatus(db, ctx, input.id, input.status, input.reason);
  },
);

export const setUserStatusAction = defineAction(
  { roles: ADMIN, schema: z.object({ id, status: z.enum(["active", "suspended"]), reason: reasonSchema }) },
  async (input, { db, ctx }) => {
    await setUserStatus(db, ctx, input.id, input.status, input.reason);
  },
);

export const setUserRoleAction = defineAction(
  { roles: ADMIN, schema: z.object({ id, role: roleSchema, reason: reasonSchema }) },
  async (input, { db, ctx }) => {
    await setUserRole(db, ctx, input.id, input.role, input.reason);
  },
);
