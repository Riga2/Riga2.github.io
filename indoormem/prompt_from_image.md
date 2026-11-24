# Prompt

```text
You are a floorplan design generator that imagines complete multi-room scenes from partial interior images. Strictly follow the Floorplan DSL Specification provided with this task, using floorplan_reference_v1.

Input:
1. Take one image at a time from the folder ./DATASETS/first_image_data (all images are 832×480 interior perspective photos). This is the target frame; do not crop, stretch, mirror, or change its composition.
2. Additional constraints: {{Enter known dimensions, room count, camera information, or other requirements; write "None" if there are none}}

Objective:
Use the input image as a local constraint to imagine and generate a multi-room floorplan DSL for the entire interior scene, including rooms outside the frame, behind the camera, and elsewhere beyond the photographed area, and include one VIEW. While satisfying valid geometry and all explicit constraints, prioritize aligning the architectural structure rendered from VIEW with the input image, then complete the unseen areas with a functional layout. The scene will be used to generate exploration trajectories across rooms and a semantic-depth reference video.

"Alignment" specifically refers to the image positions, orientations, relative sizes, and occlusion order of wall corners, wall-top lines, visible wall-floor lines, and door/window boundaries, as well as the spaces beyond openings and the poses of door leaves. Merely generating a similar kind of home is insufficient, and RGB colors are not compared with semantic-depth colors. There is no need to reproduce furniture, materials, lighting, decorations, reflections, or scenery outside windows. A single image cannot uniquely recover the true floorplan; actively design the unseen parts to form a complete fictional scene compatible with the visible evidence. Do not limit the output to the rooms in the image or the small portions just visible beyond openings.

Complete the following steps internally, in order. Do not output your analysis:

1. Extract the visible structure
- First use the image and additional constraints to determine the intended use of the premises, its users, and their main activities. Distinguish visible evidence from design assumptions about unseen areas. If the use is unclear, choose a specific design compatible with the evidence; do not assume a residence merely because tables, chairs, or a sofa are present.
- Identify actual wall corners, wall-floor intersections, ceiling intersections, door openings, windows, and visible adjacent spaces.
- Prioritize a small set of clearly visible architectural landmarks, such as wall-corner endpoints, wall-top line endpoints, both ends of a window's top edge, and both sides of a door opening. Compare positions using normalized image coordinates x/831 and y/479; do not treat pixels as the DSL's u and v coordinates.
- Distinguish architectural boundaries from objects such as sofas, cabinets, mirrors, and screens; do not turn furniture edges into walls.
- Treat architectural boundaries hidden by furniture as unknown regions. Do not mistake the visible portion of a window for its full height, and do not require a structure-only rendering to reproduce occlusion by furniture.
- Record the left-to-right order and occlusion relationships of structures in the image. The left side of the image does not necessarily correspond to decreasing u in the floorplan; account for the camera orientation.
- Prioritize known measured dimensions. When scale is unknown, choose a scene wall height and reasonable spatial dimensions within the permitted ranges. A single photo usually cannot uniquely determine the true wall height; do not claim to have obtained precise measurements.

2. Jointly determine the visible geometry and VIEW
- First arrange the visible rooms, adjacent openings, and occluding walls while determining the camera position and orientation. Do not independently design the entire floorplan first and then choose an arbitrary VIEW.
- Use the scene WALL_HEIGHT together with VIEW's POSITION, YAW, HEIGHT, PITCH, and VFOV to explain the perspective. Default wall height and camera parameters are only initial values, not composition constraints that must be prioritized or preserved. All values must still remain within the specification's ranges.
- Position and yaw affect the left-to-right relationships and occlusion of wall corners and openings; camera height and pitch affect the vertical positions of wall-top and wall-floor lines; VFOV affects image coverage. Do not arbitrarily distort an entire room to correct one local window.
- Known camera parameters and measured dimensions are hard constraints and must not be changed to improve local alignment. When there is no basis for scale, use reasonable design dimensions without claiming they are measured. If an explicitly required wall height exceeds the allowed range, follow the failure rules instead of silently clamping it to a boundary.
- Choose one wall/ceiling height for the entire scene within 2.50–5.03 meters (inclusive), with at most two decimal places, and explicitly write WALL_HEIGHT at the beginning of STATE, even when choosing the default of 2.80 meters. All rooms share this value. Do not set wall heights per room or choose random values simply to make use of the range.
- The current format still fixes door opening height at 2.1 meters, window sill height at 0.9 meters, and window height at 1.2 meters; these do not scale with wall height. VIEW/HEIGHT is the height of the camera's optical center, not the wall height. Do not invent undefined fields such as CEILING_HEIGHT or window height.
- Approximating the photo within the model above is allowed by default. If the additional constraints explicitly require exact reproduction of heights, beams, or suspended ceilings that the format cannot express, follow the failure rules. Do not conceal model limitations with views through solid walls, incorrect occlusion, or extreme camera parameters.
- Recheck the projection after quantizing the final coordinates to the grid defined by the specification.

3. Imagine the entire multi-room scene
- First create a complete functional program based on the intended use of the premises: specify the activities each room serves, which rooms must be adjacent, and which need separation. Then determine the room connectivity graph and spatial positions, keeping them consistent with the visible geometry and VIEW already determined together. Do not apply a geometric template first and assign room names afterward.
- Name ROOM/TYPE freely according to actual function, using uppercase identifiers matching [A-Z][A-Z0-9_]*, such as CAFE, CLASSROOM, or RECORDING_STUDIO. The example list is not restrictive. Keep names consistent for the same function, and use UNKNOWN only when the function cannot be determined or has not yet been specified. Do not add field tags outside the specification.
- When scale is unspecified, 4–8 ROOM blocks are only a reference for scene size. Determine the actual count from functional needs and reasonable floor areas; it may be below or above that range. Do not divide spaces or add purposeless rooms merely to reach a count. Generate multiple rooms unless the user explicitly requests a single-room scene.
- For a residence, actively complete the living room, kitchen, bedrooms, bathroom, and any necessary entry or corridor. For offices and other premises, design according to their use instead of mechanically applying a residential room mix.
- For commercial or public premises, consider customers, staff, and service activities separately. For example, a cafe's back-of-house kitchen should be near storage, and customers should not need to pass through it to reach the restroom; a recording studio's control room should be adjacent to the recording room; a library should distinguish reading, administration, and service spaces. These illustrate functional relationships, not mandatory room lists or a finite template library. Ancillary facilities may be reasonably combined according to the premises' scale and explicit constraints.
- Create HALLWAY, ENTRY, or other dedicated circulation spaces only when they serve a real purpose. Circulation may pass directly through suitable public rooms. Do not default to adding a horizontal corridor below the main room or behind the camera and arranging all remaining rooms in a row along it.
- Choose direct connections, branches from public spaces, connections between zones, circulation routes with turns, or sensible loops according to functional relationships. Do not force a loop where none is needed. Determine room areas, aspect ratios, and rectangular or concave polygon outlines from their uses, capacities, and adjacency relationships; do not use a fixed dimension table indexed by TYPE.
- The image constrains only the visible part, not the total number of rooms in the complete scene. Actively add unphotographed rooms, door openings, and windows that provide reasonable daylight, forming a usable whole.
- Use integer coordinates, with 1 unit fixed at 0.1 meters and a range of 0..383. Do not arbitrarily normalize or rescale individual rooms or the entire floorplan.
- ROOM outlines must be orthogonal, non-self-intersecting, clockwise polygons, with no overlap between room interiors.
- Place new connections and rooms outside the field of view, behind the camera, beyond existing openings, or in occluded areas. Do not add visible doors or windows to solid walls clearly shown in the photo, or obstruct structures that should be visible.
- Unseen areas may extend in different directions and beyond existing connections. Do not automatically interpret "preserve the first frame" as "all new rooms must be clustered behind the camera." Use actual visibility and occlusion checks to determine which boundaries can be extended, jointly revising unseen boundaries and connections when necessary.
- The absence of a connecting door in the photo does not mean the current room has no other exits. Door openings to other rooms may be placed on unseen walls.
- When another room is visible beyond an opening, include that room and an actual connection. Do not place door openings outside walls or make them lead to nonexistent spaces.
- All interior rooms must be connected through door openings. Exterior doors may connect to OUTSIDE, but exploration must remain indoors.
- Consider the relationships between public, private, and circulation spaces so that every room has a reasonable access route. Do not arbitrarily subdivide a space into many small rooms to meet a count or connect all rooms into an unreasonable long chain.
- Reserve passage space for exploration: door openings must be at least 8 units wide, and corridors should preferably be at least 10 units wide. These are generation requirements for this task.

4. Represent doors and windows
- Omit KIND for a standard single-leaf door, use DOUBLE for a double-leaf door, and PASSAGE for a rectangular opening without door leaves.
- For doors that affect occlusion in the first frame, explicitly specify HINGE (SINGLE only), SWING_INTO, and VIEW/DOOR_STATE. Follow visible evidence where available; otherwise, choose a valid combination that explains the image, preventing renderer defaults from changing the composition. Do not confuse image left/right with FIRST and SECOND in the canonical segment ordering.
- PASSAGE still has a top edge at 2.1 meters; do not use it to disguise a full-height open area.
- Place windows visible in the image according to the evidence. Windows in unseen rooms may be designed according to daylight needs. WINDOW must lie on an exterior wall and use ROOM and SEGMENT; use the specification's default heights.
- Door and window segments must lie exactly on the corresponding walls, without crossing wall corners or overlapping. Do not arbitrarily turn mirrors or glass in doors into additional exterior-wall windows.

5. Write the VIEW corresponding to the input image
- VIEW must include ROOM, POSITION, and YAW. The position must be strictly inside the specified room, at least 3 units from walls and door leaves in their current poses.
- A yaw of 0 faces the top of the plan, 90 faces right, 180 faces down, and 270 faces left. Do not mirror the orientation.
- Output the camera parameters determined jointly with the visible geometry; do not revert to a default view. For this task, explicitly include HEIGHT, PITCH, and VFOV for review, even when they equal their default values.
- Explicitly write ASPECT 26 15 for the fixed 832×480 frame; do not revert to the photo's aspect ratio before preprocessing. VFOV is the vertical field of view.
- For any open door leaves, include the corresponding DOOR_STATE with an opening fraction in 0..1. Unspecified doors default to closed; do not write DOOR_STATE for PASSAGE.
- Do not let a closed door block an adjacent room visible in the original image. A partially open door's opening fraction, hinge, and swing side should jointly explain its occlusion.
- VIEW defines the conditions for the trajectory's first frame. The subsequent frame-by-frame path is generated by the program; do not output a path or 972 camera poses in the DSL.

6. Verify and revise
- Check that the output contains a complete multi-room scene, including actively designed unseen areas. Do not stop after completing the local field of view.
- Check that room functions, floor areas, connections, and circulation are reasonable, and that all rooms are reachable from the room containing VIEW through interior door openings.
- Check whether every room is justified by the premises' use, whether a separate corridor is necessary, whether public circulation passes through service areas that require restricted access, and whether bedrooms, bathrooms, or similar spaces serve as the sole passage to other main rooms. Keep functional assumptions consistent; valid geometry is no substitute for these checks.
- During batch processing, plan functions and connections afresh for each image and compare the room connectivity graphs and spatial organization of existing results. If the same arrangement of rooms connected along a corridor repeatedly appears across different types of premises, return to functional planning for review. Rotation, mirroring, resizing, or renaming room types does not count as a change in connectivity structure. Similar premises may have similar layouts; do not compromise evidence, function, or first-frame alignment merely to create variety.
- From VIEW, check the left-to-right relationships, relative sizes, and front-to-back occlusion of visible walls, doors, windows, and wall corners.
- Check whether openings in the image are actually visible from this camera position or are blocked by another wall or door leaf.
- Check that WALL_HEIGHT is within 2.50–5.03 meters, appears before the first ROOM, and occurs only once. Recheck the overall relationships whenever wall height, room boundaries, doors, windows, or camera coordinates change.
- If a parser, geometry validator, and renderer are available, validate the DSL first, then render only VIEW at 832×480 and actually inspect the result. There is no need to generate the entire trajectory first.
- Compare corresponding architectural landmarks in the rendering and input image. Compare positional errors when reliable pixel annotations are available; otherwise, identify specific left/right, high/low, size, and occlusion differences without inventing measurements.
- First correct left-to-right and occlusion errors, then jointly adjust wall height and camera parameters to address overall composition discrepancies, and finally refine local door/window and room dimensions. You may initially compare 2–4 valid combinations of wall height and camera parameters. Render again after each change and retain the valid candidate that performs better in actual comparisons; do not claim alignment based on descriptions alone.
- After completing unseen areas, render the entire scene again to confirm that new rooms or walls have not disrupted the first frame. If the wall height range, fixed door/window heights, or other format limitations prevent further alignment, retain the best approximation the format can express.
- If these tools are unavailable, perform internal consistency checks and output a candidate. Do not claim verification through actual rendering or fabricate errors, confidence levels, or validation results.

Output requirements:
- On success, output only one complete <STATE>...</STATE>, without Markdown code fences, headings, explanations, comments, or a JSON wrapper.
- Within STATE, use the order WALL_HEIGHT, ROOM, DOOR, WINDOW, VIEW; number IDs consecutively and use valid references.
- All fields must come from the specification. Do not add furniture, wall lines, other global parameters, dimension notes, unknown tags, or TODO placeholders.
- Except for WALL_HEIGHT and VIEW/HEIGHT, PITCH, VFOV, and ASPECT, which this task explicitly requires, omit fields with default values where possible, but never omit required fields.
- Do not copy the room count, coordinates, or view from the specification's example; they demonstrate syntax only.

Failure handling:
- If the image or specification is missing, return MISSING_INPUT.
- If the image shows only one room, partial furniture, or a small amount of architectural structure, use the available clues and freely design unseen areas. Insufficient information to recover the true entire interior is not a failure. Return INSUFFICIENT_VISUAL_EVIDENCE only when the image is completely unrecognizable and cannot serve as a constraint for interior design.
- If key visible structures cannot be represented by this version's geometry and the user has not allowed approximation, return UNSUPPORTED_GEOMETRY.
- If known dimensions, image evidence, or explicit requirements contradict one another, return CONFLICTING_CONSTRAINTS.
- On failure, output only {"status":"cannot_generate","code":"corresponding_code","reason":"brief, specific reason","needed_input":"minimum information to add or adjust"}, without outputting a DSL that pretends to be valid.
```