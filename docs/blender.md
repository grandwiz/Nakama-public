# Make something in Blender

Nakama can ask a connected AI to write a Blender Python scene, save it into a project, and run your reviewed script on the Windows PC. Your PC must be awake, with Blender installed. This uses Blender's command-line interface; it does not move your mouse around the Blender editor.

## Your first scene

1. Create a project and open its assistant.
2. Select **Build files**, choose a connected model, and ask: “Create `scene.py` using Blender's bpy API. Make a friendly blue mascot. Save a `.blend` file and a PNG beside the script. Do not install packages or use the network.”
3. Wait for Nakama to report which files it actually saved. Open `scene.py` in the project editor and review it.
4. Request a Blender run for `scene.py`. Read the approval. Python scripts run with your Windows account's permissions.
5. Approve once. Follow the task in Activity. When Blender finishes, use **Open project folder** to view the outputs.

An included starter lives at `examples/blender/scene.py`. Copy it into one of your runtime projects to try the same workflow without using a model.

## What Nakama checks

The scene script must be inside the selected project and under 1 MB. Nakama saves its hash with the request and refuses the run if you or a model change it before approval. Blender starts in the background with a factory scene and automatic loading of embedded scripts disabled. The explicitly approved Python script still runs: these flags do not sandbox Python or limit its Windows permissions. Commands stop after 30 minutes and have a Stop button.

Nakama does not install Blender for you, choose a paid render service, publish a render, or claim a render completed just because a model described one. The task log and generated files provide the result.
