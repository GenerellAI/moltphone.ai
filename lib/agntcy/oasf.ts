/**
 * OASF (Open Agentic Schema Framework) export mapper.
 *
 * Transforms a Molt Agent Card into an AGNTCY-consumable OASF record.
 * The Agent Card remains the canonical representation — this is a
 * one-directional adapter for AGNTCY ecosystem interoperability.
 *
 * Design principles:
 *   - Pure function: Agent Card in → OASF record out.
 *   - Never leaks endpointUrl or other non-public config.
 *   - Molt-specific semantics preserved in `x-molt` module.
 *   - Deterministic: same input always produces same output.
 *
 * @see https://docs.agntcy.org/oasf/open-agentic-schema-framework/
 * @see docs/research/agntcy-quick-wins-plan.md
 */

// ── OASF record types ───────────────────────────────────

/** OASF skill descriptor. */
export interface OASFSkill {
  id: string;
  name: string;
  description?: string;
  /** Optional OASF taxonomy tags (not used by Molt internally). */
  tags?: string[];
}

/** OASF locator — where to reach this agent. */
export interface OASFLocator {
  /** Protocol / transport type. */
  type: string;
  /** URL for this locator. */
  url: string;
}

/** OASF capabilities. */
export interface OASFCapabilities {
  streaming: boolean;
  push_notifications: boolean;
  state_transition_history: boolean;
  input_modes: string[];
  output_modes: string[];
}

/** OASF authentication descriptor. */
export interface OASFAuthentication {
  schemes: string[];
  required: boolean;
}

/** OASF provider info. */
export interface OASFProvider {
  organization: string;
  url: string;
}

/** Molt-specific module in the OASF record. */
export interface OASFMoltModule {
  molt_number: string;
  nation: string;
  nation_type: 'carrier' | 'org' | 'open';
  public_key: string;
  inbound_policy: 'public' | 'registered_only' | 'allowlist';
  direct_connection_policy: string;
  timestamp_window_seconds: number;
  registration_certificate?: Record<string, unknown>;
  carrier_certificate_url?: string;
  lexicon_url?: string;
}

/**
 * Full OASF record — the export shape that AGNTCY consumers can discover,
 * index, and interpret.
 */
export interface OASFRecord {
  /** OASF schema version. */
  oasf_schema: '1.0.0';
  /** Source schema reference. */
  source_schema: string;
  /** Human-readable agent name. */
  name: string;
  /** Agent description. */
  description?: string;
  /** Agent version string. */
  version: string;
  /** Unique agent reference (MoltNumber). */
  agent_ref: string;
  /** Provider info. */
  provider: OASFProvider;
  /** Locators — how to reach this agent. */
  locators: OASFLocator[];
  /** Agent skills / capabilities. */
  skills: OASFSkill[];
  /** Capabilities summary. */
  capabilities: OASFCapabilities;
  /** Authentication requirements. */
  authentication: OASFAuthentication;
  /** Current status. */
  status?: 'online' | 'offline';
  /** Whether the agent is degraded (webhook unreliable). */
  degraded?: boolean;
  /** Vendor-specific modules. */
  modules: {
    'x-molt': OASFMoltModule;
  };
}

// ── Input type: the Agent Card shape from our route ─────

/**
 * The Agent Card object produced by GET /call/:moltNumber/agent.json.
 * This mirrors the response shape without importing from the route.
 */
export interface AgentCardInput {
  schema?: string;
  name: string;
  description?: string;
  url: string;
  provider: {
    organization: string;
    url: string;
  };
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory?: boolean;
  };
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  skills: Array<{ id: string; name: string; description?: string }>;
  authentication: {
    schemes: string[];
    required: boolean;
  };
  status?: string;
  degraded?: boolean;
  'x-molt': {
    molt_number: string;
    nation: string;
    nation_type: 'carrier' | 'org' | 'open';
    public_key: string;
    inbound_policy: 'public' | 'registered_only' | 'allowlist';
    direct_connection_policy: string;
    timestamp_window_seconds: number;
    registration_certificate?: Record<string, unknown>;
    carrier_certificate_url?: string;
    lexicon_url?: string;
  };
}

// ── Skill description map ───────────────────────────────

const SKILL_DESCRIPTIONS: Record<string, string> = {
  call: 'Multi-turn conversation (streaming)',
  text: 'Fire-and-forget message (single task)',
};

// ── Mapper ──────────────────────────────────────────────

/**
 * Convert a Molt Agent Card to an OASF record.
 *
 * Pure function — no side effects, no database access, no secrets.
 * Deterministic: same input always produces the same output.
 */
export function agentCardToOASF(card: AgentCardInput): OASFRecord {
  const xMolt = card['x-molt'];

  // Build the agent.json URL from the task/send URL
  // card.url = "https://carrier/call/MPHO-XXXX/tasks/send"
  // agent card = "https://carrier/call/MPHO-XXXX/agent.json"
  const agentCardUrl = card.url.replace(/\/tasks\/send$/, '/agent.json');

  const record: OASFRecord = {
    oasf_schema: '1.0.0',
    source_schema: card.schema || 'https://moltprotocol.org/a2a/agent-card/v1',
    name: card.name,
    version: card.version,
    agent_ref: xMolt.molt_number,
    provider: {
      organization: card.provider.organization,
      url: card.provider.url,
    },
    locators: [
      {
        type: 'a2a',
        url: card.url,
      },
      {
        type: 'agent-card',
        url: agentCardUrl,
      },
    ],
    skills: card.skills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description || SKILL_DESCRIPTIONS[s.id],
    })),
    capabilities: {
      streaming: card.capabilities.streaming,
      push_notifications: card.capabilities.pushNotifications,
      state_transition_history: card.capabilities.stateTransitionHistory ?? false,
      input_modes: card.defaultInputModes ?? ['text'],
      output_modes: card.defaultOutputModes ?? ['text'],
    },
    authentication: {
      schemes: card.authentication.schemes,
      required: card.authentication.required,
    },
    modules: {
      'x-molt': {
        molt_number: xMolt.molt_number,
        nation: xMolt.nation,
        nation_type: xMolt.nation_type,
        public_key: xMolt.public_key,
        inbound_policy: xMolt.inbound_policy,
        direct_connection_policy: xMolt.direct_connection_policy,
        timestamp_window_seconds: xMolt.timestamp_window_seconds,
      },
    },
  };

  // Optional fields
  if (card.description) {
    record.description = card.description;
  }

  if (card.status === 'online' || card.status === 'offline') {
    record.status = card.status;
  }

  if (card.degraded) {
    record.degraded = true;
  }

  // Optional x-molt fields
  if (xMolt.registration_certificate) {
    record.modules['x-molt'].registration_certificate = xMolt.registration_certificate;
  }
  if (xMolt.carrier_certificate_url) {
    record.modules['x-molt'].carrier_certificate_url = xMolt.carrier_certificate_url;
  }
  if (xMolt.lexicon_url) {
    record.modules['x-molt'].lexicon_url = xMolt.lexicon_url;
  }

  return record;
}
