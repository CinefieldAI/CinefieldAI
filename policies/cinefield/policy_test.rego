# =============================================================================
# CINEFIELD POLICY GATE — Rego conformance suite (Phase 12-E)
# =============================================================================
# Run with:  opa test policies/
#
# This file contains no expectations of its own. It iterates
# policies/conformance/cases.json — the SAME file the TypeScript suite
# iterates — so the normative Rego and the runtime evaluator are checked
# against one shared table rather than against two hand-maintained lists that
# would quietly diverge on the first change either side.
#
# Adding a case to cases.json therefore extends both suites at once, and a
# case that only one side satisfies fails somewhere. That is the whole point:
# Phase 19 will replace the runtime evaluator with an OPA bundle, and this
# table is what makes that swap provable rather than hopeful.
#
# The parity assertions at the bottom check the registry itself, because a
# registry entry with a missing field would otherwise produce a silent DENY
# that looks like correct fail-closed behaviour.
# =============================================================================

package cinefield.policy_test

import rego.v1

import data.cinefield.policy

# DATA PATHS — real, verified against `opa test` (Phase 19). OPA's own
# directory-based JSON loading puts policies/conformance/cases.json's
# content at `data.conformance` (its own top-level keys `cases`/
# `baseInput` land directly there — no extra segment from the filename)
# and policies/data/actions.json's content at `data.data` (see
# policy.rego's own header for why the file stays at that path rather than
# being moved to chase a `data.cinefield.*` shape that was never actually
# verified until now).
cases := data.conformance.cases

base := data.conformance.baseInput

# object.union is a shallow merge, which is exactly right here: every patch in
# cases.json replaces a whole top-level field (the entire `actor`, the entire
# `risk`) rather than one leaf of it, so a partial patch cannot silently
# inherit half of a nested object.
input_for(c) := object.union(base, c.patch)

# -----------------------------------------------------------------------------
# Every case, both halves of the decision.
# -----------------------------------------------------------------------------

test_conformance_decisions if {
	every c in cases {
		result := policy.decision with input as input_for(c)
		result.decision == c.expect.decision
	}
}

test_conformance_reasons if {
	every c in cases {
		result := policy.decision with input as input_for(c)
		result.reason == c.expect.reason
	}
}

# -----------------------------------------------------------------------------
# Fail-closed properties that no individual case can express
# -----------------------------------------------------------------------------

# Empty input. Not a case in the table because it has no base to patch: the
# question is what happens when the caller supplies nothing at all.
test_empty_input_is_denied if {
	result := policy.decision with input as {}
	result.decision == "DENY"
}

test_null_action_is_denied if {
	result := policy.decision with input as object.union(base, {"action": null})
	result.decision == "DENY"
}

# The decision vocabulary is closed. A rule returning something outside this
# set would be read by the runtime as an unknown decision and denied, but it
# should fail here first, where the mistake is visible.
test_decision_vocabulary_is_closed if {
	allowed := {"ALLOW", "DENY", "REQUIRE_APPROVAL", "REQUIRE_CHALLENGE", "REQUIRE_ADMIN_REVIEW"}
	every c in cases {
		result := policy.decision with input as input_for(c)
		result.decision in allowed
	}
}

# -----------------------------------------------------------------------------
# Registry integrity
# -----------------------------------------------------------------------------
# A registry entry missing `implemented` would evaluate as "not false", skip
# the not-implemented rule, and fall through to an ALLOW it was never meant to
# reach. Checking the shape here is cheaper than discovering that in
# production.

test_every_action_is_fully_specified if {
	every _, action in data.data.actions {
		is_boolean(action.critical)
		is_boolean(action.implemented)
		is_boolean(action.requiresTwoPerson)
		is_boolean(action.requiresHumanApproval)
		is_array(action.requiredRoles)
		count(action.requiredRoles) > 0
		is_string(action.owner)
	}
}

# Every role named by an action must exist in the role vocabulary, or that
# action is unreachable and the registry is lying about who can perform it.
test_every_required_role_exists if {
	every _, action in data.data.actions {
		every role in action.requiredRoles {
			role in data.data.roles
		}
	}
}

# The AI write allowlist is bounded to exactly the one entry Phase 14-B
# deliberately reviewed and added (`code.pr.create`, still human-approval-
# gated downstream — see ai-pr-authority.ts). Not empty: this Rego test was
# never actually run by `opa test` until Phase 19 and had drifted from that
# real, already-reviewed change — src/test/e2e/phase-14b-ai-pr-safety.e2e.
# test.ts's own `assert.deepEqual(registry.aiWriteAllowlist, ["code.pr.
# create"])` is the TypeScript side's matching, already-correct assertion.
# Still bounded on purpose: a future, undeliberate addition fails this test
# exactly as the original "must be empty" version intended to.
test_ai_write_allowlist_is_bounded if {
	data.data.aiWriteAllowlist == ["code.pr.create"]
}

# Everything in the registry is critical. The gate exists for critical actions
# only; a non-critical entry here would mean an ordinary operation had been
# quietly pulled behind a fail-closed boundary.
test_registry_holds_only_critical_actions if {
	every _, action in data.data.actions {
		action.critical == true
	}
}
