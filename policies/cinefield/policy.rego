# =============================================================================
# CINEFIELD POLICY GATE — Phase 12-E
# =============================================================================
# Roadmap ¶1648: "OPA/Rego policy gate + privacy/data-lifecycle güvenlik
# bağlantılarını ekle."
# Done criterion ¶1649: "Kritik action policy sonucu olmadan çalışmıyor."
#   — a critical action does not run without a policy result.
#
# THIS FILE IS THE NORMATIVE POLICY.
#
# The runtime evaluator in src/lib/policy/policy-engine.ts implements exactly
# these rules, and the two are bound together by policies/conformance/cases.json:
# `policy_test.rego` iterates that file and so does the TypeScript suite. If
# they ever disagree, one of the two runs goes red. The Rego is the
# specification; the TypeScript is an implementation of it, not a second
# opinion.
#
# WHY NOT AN OPA SIDECAR TODAY. The roadmap's own ownership decision (¶416,
# ¶3734, ¶3766) places FULL OPA among the scale-triggered layers, and Phase 19
# explicitly owns "OPA service/sidecar kur" (¶2272) and the full Rego test
# suite (¶2274). Phase 12-E owns the GATE. Standing up a policy service now
# would also make every critical action depend on a second process being
# alive, which for a fail-closed gate means an outage in that process stops
# quarantine handling — a worse failure than the one it prevents.
#
# HOW TO RUN THIS AS REAL OPA (see docs/security-gates.md for the contract):
#   opa test policies/                      # the Rego test suite
#   opa eval -d policies/ -i input.json 'data.cinefield.policy.decision'
#   opa build -t wasm -e cinefield/policy/decision policies/
#
# =============================================================================
# DEFAULT DENY IS THE FIRST LINE AND IT IS NOT NEGOTIABLE
# =============================================================================
# Every rule below can only produce a decision by matching. Anything unmatched
# — unknown action, unknown role, missing input, malformed environment, an
# action nobody has implemented — falls through to `default decision` and is
# denied. There is no rule anywhere in this file whose effect is "if we are
# not sure, allow".
# =============================================================================

package cinefield.policy

import rego.v1

# -----------------------------------------------------------------------------
# The default. Reached whenever nothing else matched.
# -----------------------------------------------------------------------------
default decision := {
	"decision": "DENY",
	"reason": "no_matching_rule",
}

# -----------------------------------------------------------------------------
# Ordered evaluation.
#
# Rego rules are unordered, so precedence is expressed as an explicit list and
# the FIRST matching entry wins. Written this way rather than as a set of
# mutually-exclusive conditions because a set of conditions that must not
# overlap is a set of conditions that eventually will.
# -----------------------------------------------------------------------------
decision := d if {
	some i
	d := candidates[i]
	not exists_earlier(i)
}

exists_earlier(i) if {
	some j
	j < i
	candidates[j]
}

# -----------------------------------------------------------------------------
# 1. Structural refusals — the input itself is not usable
# -----------------------------------------------------------------------------

# Unknown action. The registry is the whole vocabulary; a typo is a denial,
# never an unguarded call.
candidates[0] := {"decision": "DENY", "reason": "unknown_action"} if {
	not data.cinefield.actions.actions[input.action]
}

# An action nobody has built yet. The privacy actions (data.export,
# data.delete, retention.override, legal_hold.*) live here: Phase 23 owns the
# workflows, and until they exist the only correct answer is no.
candidates[1] := {"decision": "DENY", "reason": "not_implemented"} if {
	action := data.cinefield.actions.actions[input.action]
	action.implemented == false
}

# No verified subject. Not "treat as anonymous" — refuse.
candidates[2] := {"decision": "DENY", "reason": "unknown_subject"} if {
	not valid_actor
}

candidates[3] := {"decision": "DENY", "reason": "unsupported_environment"} if {
	not input.environment in data.cinefield.actions.environments
}

# A critical action may only be driven by the server. A request that came
# straight from a browser cannot reach one, no matter who is signed in: the
# origin class is set by the server that built the input, and there is no
# field a client controls that changes it.
candidates[4] := {"decision": "DENY", "reason": "untrusted_origin"} if {
	input.originClass != "server"
}

# -----------------------------------------------------------------------------
# 2. AI / MCP write authority — OFF, and off first
# -----------------------------------------------------------------------------
# Roadmap ¶1856: "MCP bağlantıları varsayılan olarak READ-ONLY başlar. Write
# işlemi yalnız AI suggestion → policy (OPA) → human approval → protected
# workflow sırasıyla mümkündür. Bu sıra hiçbir incident aciliyetiyle atlanmaz."
#
# Placed ABOVE role and risk checks on purpose. An agent must not be able to
# reach a decision by satisfying a role condition; the question "is this an
# agent?" is answered before any question that could grant something.
# ¶1854 adds that a tool-level allowlist is mandatory and that no general
# authority is ever granted — `aiWriteAllowlist` is empty, so this denies
# every write today.

candidates[5] := {"decision": "DENY", "reason": "ai_write_authority_off"} if {
	input.actor.kind == "ai_agent"
	not input.action in data.cinefield.actions.aiWriteAllowlist
}

# Even an allowlisted tool does not get to act on its own. The roadmap's
# sequence has human approval AFTER policy, so the strongest thing policy may
# return for an agent is "a human must approve this".
candidates[6] := {"decision": "REQUIRE_APPROVAL", "reason": "ai_write_needs_human_approval"} if {
	input.actor.kind == "ai_agent"
	input.action in data.cinefield.actions.aiWriteAllowlist
	not approved
}

# -----------------------------------------------------------------------------
# 3. Authorization
# -----------------------------------------------------------------------------

candidates[7] := {"decision": "DENY", "reason": "role_not_permitted"} if {
	action := data.cinefield.actions.actions[input.action]
	not input.actor.role in action.requiredRoles
}

# -----------------------------------------------------------------------------
# 4. Risk state (Phase 12-C), read from server/database state only
# -----------------------------------------------------------------------------
# The Risk Engine and the Policy Engine stay separate components. This reads
# the Risk Engine's CONCLUSION as one input among several; it does not score
# anything, and it never merges the two.

candidates[8] := {"decision": "DENY", "reason": "subject_temporarily_blocked"} if {
	input.risk.temporarilyBlocked == true
}

candidates[9] := {"decision": "REQUIRE_ADMIN_REVIEW", "reason": "risk_admin_review_required"} if {
	input.risk.adminReviewRequired == true
}

candidates[10] := {"decision": "REQUIRE_CHALLENGE", "reason": "risk_challenge_required"} if {
	input.risk.challengeRequired == true
}

# -----------------------------------------------------------------------------
# 5. Human approval
# -----------------------------------------------------------------------------
# Policy BLOCKS until evidence of approval exists. It never performs the
# approval, and it cannot: `approvalEvidence` is assembled by the server from
# durable state, and Phase 16 owns the workflow that produces it.

candidates[11] := {"decision": "REQUIRE_APPROVAL", "reason": "human_approval_required"} if {
	action := data.cinefield.actions.actions[input.action]
	action.requiresHumanApproval == true
	not approved
}

# -----------------------------------------------------------------------------
# 6. Allow — and what an allow does NOT mean
# -----------------------------------------------------------------------------
# For a two-person action, ALLOW means "policy raises no objection". It does
# NOT mean the action may proceed: the two-person threshold is enforced
# downstream by a primary key on (asset, approver) inside the SQL transaction,
# which is the only place it can be enforced correctly. The distinct reason
# code exists so a reader of the decision log can never mistake this allow for
# a satisfied approval requirement.

candidates[12] := {"decision": "ALLOW", "reason": "allowed_two_person_enforced_downstream"} if {
	action := data.cinefield.actions.actions[input.action]
	action.requiresTwoPerson == true
}

candidates[13] := {"decision": "ALLOW", "reason": "allowed"} if {
	action := data.cinefield.actions.actions[input.action]
	action.requiresTwoPerson == false
}

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

valid_actor if {
	is_string(input.actor.id)
	count(input.actor.id) > 0
	input.actor.role in data.cinefield.actions.roles
}

approved if {
	input.approvalEvidence.humanApproved == true
}
