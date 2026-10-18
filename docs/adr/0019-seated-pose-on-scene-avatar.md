# ADR-0019: An optional seated pose on `SceneAvatar`, with the numbers in the personas file

- Status: Accepted (Jian asked to proceed with VIK-62 after the VIK-60 spike)
- Date: 2026-10-17
- Deciders: Jian, Claude (VIK-62)

## Context

The table page (VIK-47) draws a row of busts facing the camera. The spike for a 3D view (VIK-60, `docs/spikes/table3d.md`) showed that avatars seated round a table, hands on the felt, read as a card table at once and cost little to draw. It also showed what the renderer cannot do today. `SceneAvatar` (`packages/engine/src/renderer.ts`) offers `scene` and `framing()`, and `VrmAvatar` adds `lowerArms()`. Nothing can bend the legs, drop the hips or rest the arms, and nothing can say where the hands ended up, which is what sets the table's height. The arm numbers that look right differ per avatar: Cookieman's rest on the table, the same numbers bend Snowy's stick arms into a W.

ADR-0005 (cartoon-first) and the VIK-32 doodle avatars mean a `SceneAvatar` will not always have a skeleton.

## Decision

Two optional methods on `SceneAvatar`, additive and with no effect on the row view:

```ts
interface SeatPose {
  /** Arms forward, down and elbow-in, in radians. Omit or set `arms: "hang"` to leave them at the sides (stick-armed models). */
  arms?: { forward: number; down: number; elbow: number } | "hang";
  /** How far the hips drop, as a fraction of their standing height. Default 0.45. */
  hipDrop?: number;
}
interface SceneAvatar {
  /** Sit: thighs forward, shins back, hips lowered, arms as asked. Returns false if this avatar cannot (no skeleton). */
  seat?(pose?: SeatPose): boolean;
  /** Height in world units where the hands rest now (after `seat`), so the page can put the table top there. */
  handHeight?(): number;
}
```

- An avatar that does not offer `seat` stays in the row. `?view=table` falls back to the row, with a line in the HUD saying why, never a broken scene.
- A model with no leg bones keeps standing legs (the table hides them). The pose never throws on a missing bone.
- The table height is the **median** of the seated avatars' `handHeight()`, so one odd avatar does not decide.
- Pose numbers are data beside the avatar: an optional `pose: { arms, hip_drop }` on a persona in the personas file, passed to the page in `personas.json`. The defaults are the spike's numbers for a humanoid VRM. `arms: hang` is how a stick-armed avatar says so.
- The page keeps no game logic: `table_state` stays the only input for what is drawn on the table.

## Consequences

- The personas schema grows by one optional key; `protocol_version` stays 1 (the pose is served by the HTTP persona list, not the WebSocket protocol).
- Every new avatar may need its own pose numbers to look natural. Until it has them, the default can look wrong; that is a data fix, not a code one.
- The row stays the default and the view for meetings and MJPEG, where big faces matter.

## Alternatives considered

- **Pose numbers in code per avatar file name.** Breaks for a user's own avatar and hides the numbers from the personas file where they are edited.
- **A fixed table height.** The spike hid the forearms of seated avatars with one.
- **Make `seat` mandatory.** Forces a doodle or sprite avatar to fake a skeleton.
- **A separate `SeatedAvatar` type.** One more interface for the page to check; optional methods say the same thing with less.
- **Correction (VIK-81, 2026-10-18):** the first numbers bent the thighs the wrong way round for the real VRM 0.x models: the legs ran away from the table while the torso and arms faced it, which the low default camera hid. The thigh and shin signs are now reversed, and the page reports `kneeReach` (metres the knees are toward the table from the hips) so a test can see it. Check a new avatar with the `?cam=x,y,z,tx,ty,tz` debug camera from the side.
- **Update (VIK-87, 2026-10-18):** the felt is an oval (`TABLE_A` 1.45 m by `TABLE_B` 0.82 m, from `table3d.ts`) and not a circle: Jian found the circle too small and the players too close. Seats sit just behind the rail facing straight in, and a seat's cards, chips and button are placed from the seat, not from the middle (`seatSlots`). The camera is wider (38 degrees) and pulls back to fit the seats at the ends. Five or more seats go round the whole oval; the near-side ones are not framed well yet (VIK-88).
