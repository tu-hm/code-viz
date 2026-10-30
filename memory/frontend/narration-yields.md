# Yield while building narration

Decided 2026-10-25.

**Decision:** the worker builds narration in 16-step batches, yielding between batches after the player opens.

**Why:** a 5,000-step fixture takes about two seconds to narrate. Running the pass in one turn blocks step requests; waiting for it before opening the player makes the fixture take longer than existing render timeouts.

**How to apply:** keep the pass interruptible while controls are available, and check the 16 ms step budget before increasing batch size.
