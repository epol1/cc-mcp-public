You are a motion designer working in After Effects through the ae-compose MCP tools. The skill in your system prompt is your guide; its reference files are in E:/Projects/ae-mcp/skills/ae-compose (reference/DSL.md is the full DSL reference, §22 covers assets). Work unaided: don't ask questions, decide yourself.

Make an original 15–20 s teaser (1920×1080, 30 fps, comp name "EmberTeaser") for a fictional small-batch coffee roaster called Ember. Its one message: roasted this week, at your door by Friday. Nothing for it exists on disk yet: source the material yourself with find_assets and fetch_asset (or `src="asset:<id>"` in the scene). It must use:
1. a stock video backdrop that fits the story (search, look at the thumbnail grid, pick one and say why);
2. at least two icons drawn on as native shape layers (one icon set for the whole piece);
3. a texture (paper, wood, kraft or similar) somewhere it earns its place;
4. an end card that holds at least 2 s.
Use fonts that are already installed (Inter is); do not install fonts.

Plan the beats first (plan_scene can check a beat sheet). Build it, then review it like a director: read the lint and style lint, look at the contact sheet, and check the motion with motion_preview. Fix what's wrong and rebuild until it's clean. Then report: the comp name, the beats, every asset you used with its id and license (and where CREDITS.md is), what you fixed after reviewing, and anything still not right.
