// voicast が送る Webhook（Webhook Admin 経由、Standard Webhooks の本文 { type, timestamp, data }）と、通話中の道具の呼び出しの型。
// apps/worker/src/postcall.ts・billing.ts・prepaid.ts と apps/voice/tools.py に合わせる。
import type { Call, CallChannel, ConnectionStatus, TranscriptTurn } from './types';

/** The tenant a call event belongs to. */
export interface EventTenant {
  id: string;
  external_id: string;
}

export interface CallStartedData {
  call_id: string;
  provider_call_id: string | null;
  from: string | null;
  started_at: number;
  tenant: EventTenant;
}

export interface CallHandoffRequestedData {
  call_id: string;
  provider_call_id: string | null;
  reason: string | null;
  fields: Record<string, string>;
  tenant: EventTenant;
}

export type CallEndedData = Call & { tenant: EventTenant };

export interface CallTranscriptReadyData {
  call_id: string;
  provider_call_id: string | null;
  turns: TranscriptTurn[];
  tenant: EventTenant;
}

export interface CallSummaryReadyData {
  call_id: string;
  provider_call_id: string | null;
  summary: string;
  category: string;
  fields: Record<string, string>;
  tenant: EventTenant;
}

export interface ConnectionNeedsReauthData {
  connection_id: string;
  connector: string;
  label: string;
  status: ConnectionStatus;
  /** `null` for an environment connection. */
  tenant: EventTenant | null;
}

export interface BillingBalanceLowData {
  organization_id: string;
  balance_yen: number;
  threshold_yen: number;
}

export interface BillingBalanceDepletedData {
  organization_id: string;
  balance_yen: number;
  call_id: string;
}

export interface BillingRechargeFailedData {
  organization_id: string;
  invoice_id: string;
  amount_yen: number;
  attempt: number;
  max_attempts: number;
  auto_recharge_disabled: boolean;
  decline_code: string | null;
  balance_yen: number;
}

/** The auto-recharge monthly cap was reached. */
export interface BillingCapReachedData {
  organization_id: string;
  kind: 'auto_recharge';
  /** `YYYY-MM` in Japan time. */
  month: string;
  spending_cap_yen: number;
  recharged_yen: number;
  amount_yen: number;
  balance_yen: number;
}

/** Event type → `data`. */
export interface VoicastEventMap {
  'call.started': CallStartedData;
  'call.handoff_requested': CallHandoffRequestedData;
  'call.ended': CallEndedData;
  'call.transcript_ready': CallTranscriptReadyData;
  'call.summary_ready': CallSummaryReadyData;
  'connection.needs_reauth': ConnectionNeedsReauthData;
  'billing.balance_low': BillingBalanceLowData;
  'billing.balance_depleted': BillingBalanceDepletedData;
  'billing.recharge_failed': BillingRechargeFailedData;
  'billing.cap_reached': BillingCapReachedData;
}

export type VoicastEventType = keyof VoicastEventMap;

/** A webhook sent by voicast. Narrow on `type` to get the typed `data`. */
export type VoicastEvent = {
  [K in VoicastEventType]: {
    type: K;
    /** ISO 8601. */
    timestamp: string;
    data: VoicastEventMap[K];
  };
}[VoicastEventType];

/** The call a tool call belongs to. */
export interface ToolCallContext {
  /** `try_…` in a test (`tools.try`). */
  id: string;
  /** `test` in a test (`tools.try`). */
  channel: CallChannel | 'test';
  provider_call_id: string | null;
  /** The caller's number (phone calls, when your Twilio app passed `from`). */
  from?: string | null;
  /** `null` in a test without `tenant_id`. */
  tenant: EventTenant | null;
}

/**
 * Body of an in-call tool request (`config.tools[].url`). Reply with 2xx and JSON within 8 seconds;
 * the JSON is given to the AI as is.
 */
export interface ToolCallRequest<A = Record<string, unknown>> {
  type: 'tool.call';
  /** The tool's `name`. */
  tool: string;
  /** Unique per call of a tool; also sent as `idempotency-key`. Use it to avoid booking twice. */
  tool_call_id: string;
  arguments: A;
  call: ToolCallContext;
  /** `true` when sent by `tools.try` (or the dashboard's test button), not during a call. */
  test?: true;
}
