# ADR-0031: A seated avatar's hands act the decision

- Status: Accepted (VIK-137)
- Date: 2026-10-22
- Deciders: Claude (default chosen; Jian may redirect)

## Context

VIK-136 made each decision audible and gave the banner an icon. The seats themselves stayed still, though their hands are on the table. A knock, a push and a toss say what a player did without a word.

## Decision

- `arm-act.ts` (pure) maps a move to an act: a check is a **knock** (two raps of the right forearm), a call, bet or raise a **push** (both hands reach forward and come back), a fold a **toss** (a quick flick of the right hand). Each is a short curve of changes to the seat pose's three numbers (`forward`, `down`, `elbow`), so no bone is touched except through the same function that sits the avatar (`poseArm` in `seat-pose.ts`).
- `VrmAvatar` keeps the arms' seated numbers and recomputes the arm quaternions from them plus the act's offsets each frame; at rest it does nothing (`setArmOffsets`).
- `Puppet.act` plays the act if the avatar `canAct` (seated, with upper and lower arm bones, and not `pose.arms: hang`); otherwise the seat **nods** (the existing `nod` gesture), so a stick-armed or unseated avatar still shows a move. The page asks for an act on every decision beat that is not a silent review.
- The page records each act in `__vikaki.table.acted` and can freeze a pose for a picture (`holdAct`), since a screenshot cannot catch a 0.9 s motion on a software-rendered page.

## Checked

By screenshot, frozen mid-act, every avatar in `packages/engine/public/avatars` (cookieman, snowy, cactusboy, froggy, lilbro, mushy, wambo): all seven moved their arms visibly with the default pose, so none needs the nod today. The nod is tested with a fake avatar. A persona that sets `pose.arms: hang` gets the nod.

## Not done

No chips are lifted or pushed with the hands, and no cards are tossed in the hand: the props already move on their own (ADR-0025). Only the arms move, so the hand and the chips are not synchronised; the amplitudes are modest and can be tuned in `armOffsets`.
