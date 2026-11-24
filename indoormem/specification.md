# Floorplan DSL Specification

`floorplan_reference_v1` describes a single-story orthogonal floorplan, including a scene-wide wall height, rooms, door openings, windows, and an optional reference view. The primary design goal for generated floorplans is a functional, sensible layout; suitable circulation loops are a secondary consideration.

## File Structure

A file contains one root `<STATE>` block, with the following fields and blocks in order:

| Field or block | Count | Content |
| --- | --- | --- |
| `WALL_HEIGHT` | Zero or one | Wall and ceiling height shared across the scene; defaults to 2.80 meters |
| `ROOM` | At least one | Room type and outline |
| `DOOR` | Zero or more | Door opening, connectivity, and door leaf type |
| `WINDOW` | Zero or more | Windows on exterior walls |
| `VIEW` | Zero or one | Reference camera and door states for that view |

Opening and closing container tags each occupy their own line. Fields use the form `<TAG> value </TAG>`. Tags, enum values, and room type identifiers are uppercase. Do not use XML attributes, comments, or custom field tags. `ROOM/TYPE` values may be freely named according to the rules below; they are not a fixed enum. Blank lines may be omitted.

Room IDs are `R0,R1,...`, door opening IDs are `D0,D1,...`, and window IDs are `W0,W1,...`. Each sequence starts at zero and is consecutive; blocks of the same type appear in ID order. `OUTSIDE` is a reserved value representing the outdoors and does not require a declaration; all other references must point to declared objects. Fields must not be repeated, except for vertices, segment endpoints, and `DOOR_STATE` entries for different doors.

## Coordinates and Dimensions

Planar points are written as `u v`: `u` increases to the right and `v` increases downward. Room vertices and door/window endpoints use integers in `0..383`, with `1 unit = 0.1 meters`.

The corresponding world coordinates are `X=0.1u` and `Z=-0.1v`; `Y` is the height above the floor, in meters.

`WALL_HEIGHT` is a direct child field of `<STATE>` and appears before the first `ROOM`, written as `<WALL_HEIGHT> 3.20 </WALL_HEIGHT>`. It is measured in meters, with an allowed range of **2.50–5.03 (inclusive)**. The value must be finite and have at most two decimal places; if omitted, it defaults to **2.80 meters**. All rooms share this height, and ceilings are level with the tops of the walls. Per-room or per-wall heights are not supported. This field is independent of `VIEW/HEIGHT` (the height of the camera's optical center).

The following dimensions are implicit in the format. They are not specified per scene and do not scale with wall height:

| Item | Fixed value |
| --- | --- |
| Floor height | 0 meters |
| Bottom and top of door openings | 0 meters, 2.1 meters |
| Door leaf thickness and maximum opening angle | 0.12 meters, 90° |
| Window sill height and window height | 0.9 meters, 1.2 meters |

Walls are represented by room boundaries. Shared boundaries represent the same wall; no separate wall blocks are used. Door and window widths are determined by the lengths of their segments.

## ROOM

All fields are required and appear in the following order:

| Field | Format | Meaning |
| --- | --- | --- |
| `ID` | `R` followed by a nonnegative integer | Room ID |
| `TYPE` | A customizable room type identifier | The room's actual function |
| `POLYGON` | Multiple `<VERTEX> u v </VERTEX>` entries | Room outline |

`TYPE` is an open-ended semantic identifier, **not limited to a fixed list and requiring no prior registration**. Choose the type based on the actual function indicated by the image, textual constraints, or your own design, such as `CAFE`, `CLASSROOM`, `LIBRARY`, `GALLERY`, `LABORATORY`, `RECORDING_STUDIO`, or `SWIMMING_POOL`. These are examples only, not a new allowlist.

Names must match the regular expression `[A-Z][A-Z0-9_]*`: start with an uppercase English letter, followed only by uppercase English letters, digits, or underscores. Use underscores to separate multiple words where appropriate. Do not include spaces, hyphens, Chinese characters, punctuation, or XML markup. For example, `<TYPE> RECORDING_STUDIO </TYPE>` is valid, while `Recording Studio` is not.

Prefer concise names that describe the space's function. Use consistent names for the same function within a scene; room numbering remains the responsibility of `ID`. The existing types `LIVING_ROOM`, `KITCHEN`, `DINING_ROOM`, `BEDROOM`, `BATHROOM`, `HALLWAY`, `ENTRY`, `OFFICE`, `STORAGE`, and `LAUNDRY` remain valid and may be used as common names. Use `UNKNOWN` when the function cannot be determined or has not yet been specified. If a known function is absent from the examples, use an appropriate custom type instead of changing it to `UNKNOWN`.

Parsers should validate the naming format and preserve valid types exactly as written. They must not reject or replace a type because it is absent from a built-in list. Downstream systems should use generic handling when they lack a display style or behavior specific to that type. A type name does not add geometric capabilities; for example, `SWIMMING_POOL` does not automatically create a recessed pool basin. All types follow the same rules for rooms, doors, windows, and `VIEW`.

An outline must contain at least four vertices in clockwise order as viewed on the plan. The polygon closes automatically; do not repeat the first vertex at the end. Edges must be horizontal or vertical and have positive length. Polygons must not self-intersect, contain holes, repeat vertices, or include redundant collinear vertices. Concave polygons are allowed.

Room interiors must not overlap. Shared boundary coordinates must match exactly.

This specification does not constrain the mix of room functions, room count, relative floor areas, arrangement directions, or connectivity topology, nor does it require a `HALLWAY` or `ENTRY`. The room list, need for dedicated circulation spaces, and adjacency relationships should follow the intended use of the premises, input constraints, and visible structure. Rectangular, L-shaped, and other valid orthogonal outlines may all be used. The shapes, layouts, and room counts in examples are not generation templates. Task-specific requirements for multiple rooms, indoor connectivity, and passage widths must still be followed.

Valid syntax and geometry do not guarantee a functional layout. During generation, also check the relationships between public, private, and service spaces, along with access, use, and circulation, according to the premises. For example, consider whether a separate corridor is needed, whether customers must pass through a back-of-house kitchen, or whether a bedroom or bathroom serves as the only route to other rooms. These are checks within the design and generation process; they are not expressed through additional DSL fields.

## DOOR

Fields appear in the order shown below:

| Field | Required | Format or values |
| --- | --- | --- |
| `ID` | Yes | `D` followed by a nonnegative integer |
| `KIND` | No | `SINGLE`, `DOUBLE`, or `PASSAGE`; defaults to `SINGLE` |
| `CONNECT` | Yes | Two distinct room IDs, or `roomID OUTSIDE` |
| `SEGMENT` | Yes | Exactly two `<POINT> u v </POINT>` lines |
| `HINGE` | No | `FIRST` or `SECOND`; applies only to `SINGLE` |
| `SWING_INTO` | No | One reference from `CONNECT`; applies only to doors with leaves |

Door types:

- `SINGLE`: A single-leaf hinged door.
- `DOUBLE`: Two equal-width door leaves, hinged at opposite ends of the segment and opening into the same connected area.
- `PASSAGE`: A rectangular opening without door leaves. The top of the opening remains at 2.1 meters, with a wall above it.

Room references in `CONNECT` are ordered by increasing numeric ID, with `OUTSIDE` last. An interior door segment must lie entirely on the shared boundary of the two rooms; an exterior door must lie on the exterior boundary of its room. Declare each physical door opening only once.

Segment endpoints must be distinct. Segments must be horizontal or vertical and must not cross wall corners. Horizontal segments are ordered from left to right, and vertical segments from top to bottom. `FIRST` and `SECOND` refer to the first and second endpoints in this order. Door and window openings must not overlap.

Omitting `HINGE` or `SWING_INTO` leaves that property unspecified for the consuming system to determine; explicitly supplied values must be honored. Do not include `HINGE` for `DOUBLE`, or either field for `PASSAGE`.

## WINDOW

The fields are `ID`, `ROOM`, and `SEGMENT`, in that order. All are required:

| Field | Format | Meaning |
| --- | --- | --- |
| `ID` | `W` followed by a nonnegative integer | Window ID |
| `ROOM` | Room ID | The room to which the window belongs |
| `SEGMENT` | Exactly two `<POINT> u v </POINT>` lines | The window's position and width on the wall |

The segment must lie entirely on the exterior boundary of its room, have positive length, cross no wall corners, and overlap no other openings. Endpoint ordering is the same as for `DOOR`. Windows do not represent passages between rooms.

## VIEW

`VIEW` defines a reference view. Fields appear in the order shown below; optional fields may be omitted when using their default values:

| Field | Required | Meaning and values |
| --- | --- | --- |
| `ROOM` | Yes | ID of the room containing the camera |
| `POSITION` | Yes | Planar coordinates `u v`, strictly inside that room |
| `YAW` | Yes | Horizontal orientation in degrees, in `[0,360)` |
| `HEIGHT` | No | Height of the optical center above the floor, in meters; defaults to `1.5`, range `0.5..2.2` |
| `PITCH` | No | Pitch angle in degrees; defaults to `0`, range `-30..30` |
| `VFOV` | No | Vertical field of view in degrees; defaults to `60`, range `20..100` |
| `ASPECT` | No | Two positive integers, `width height`; defaults to `26 15` |
| `DOOR_STATE` | No | `doorID opening_fraction`, with the opening fraction in `0..1`; unspecified doors default to closed |

For `YAW`, `0` faces the top of the plan, `90` faces right, `180` faces down, and `270` faces left. Positive `PITCH` looks downward and negative `PITCH` looks upward; roll is fixed at zero.

Camera position, height, angles, and door opening fractions may have at most two decimal places and must be finite. The camera position must not lie on a door leaf.

`DOOR_STATE` may appear multiple times, but at most once per door ID, and must not reference a `PASSAGE`. An opening fraction of `0` means closed, and `1` means open by 90°; intermediate values interpolate linearly by angle. Both leaves of a double door share one opening fraction.

## Complete Example

Two adjacent rooms are connected by a single-leaf door, with a window on the top side of the living room. The reference camera is inside the living room, facing toward the bottom of the plan, and the door is fully open.

```xml
<STATE>
<ROOM>
<ID> R0 </ID>
<TYPE> LIVING_ROOM </TYPE>
<POLYGON>
<VERTEX> 100 100 </VERTEX>
<VERTEX> 150 100 </VERTEX>
<VERTEX> 150 140 </VERTEX>
<VERTEX> 100 140 </VERTEX>
</POLYGON>
</ROOM>
<ROOM>
<ID> R1 </ID>
<TYPE> BEDROOM </TYPE>
<POLYGON>
<VERTEX> 100 140 </VERTEX>
<VERTEX> 150 140 </VERTEX>
<VERTEX> 150 180 </VERTEX>
<VERTEX> 100 180 </VERTEX>
</POLYGON>
</ROOM>
<DOOR>
<ID> D0 </ID>
<CONNECT> R0 R1 </CONNECT>
<SEGMENT>
<POINT> 120 140 </POINT>
<POINT> 130 140 </POINT>
</SEGMENT>
<HINGE> FIRST </HINGE>
<SWING_INTO> R1 </SWING_INTO>
</DOOR>
<WINDOW>
<ID> W0 </ID>
<ROOM> R0 </ROOM>
<SEGMENT>
<POINT> 110 100 </POINT>
<POINT> 130 100 </POINT>
</SEGMENT>
</WINDOW>
<VIEW>
<ROOM> R0 </ROOM>
<POSITION> 125 110 </POSITION>
<YAW> 180 </YAW>
<DOOR_STATE> D0 1 </DOOR_STATE>
</VIEW>
</STATE>
```
