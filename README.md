# Rush Hour

A speedrunning game where you traverse the London Underground (and Elizabeth line) network as quickly as possible, from a random start to a destination station.

## Screenshots

<img width="1920" height="1080" alt="Screenshot 2026-08-26 125640" src="https://github.com/user-attachments/assets/a9c24a16-3c00-48da-a278-c061d6976612" />
<img width="1920" height="1080" alt="Screenshot 2026-08-26 125704" src="https://github.com/user-attachments/assets/27f2da77-0562-4fb7-a1d0-0770f295b759" />
<img width="1920" height="1080" alt="Screenshot 2026-08-26 125733" src="https://github.com/user-attachments/assets/5bc65b0e-a492-4a20-9388-5d5faeb151c5" />
<img width="1920" height="1080" alt="Screenshot 2026-08-26 125851" src="https://github.com/user-attachments/assets/76f3f97c-422d-4fb0-89c1-2031f4b6b807" />
<img width="1920" height="1080" alt="Screenshot 2026-08-26 130020" src="https://github.com/user-attachments/assets/a1c3b81c-51f3-4a84-a35a-6cac496f9756" />
<img width="1920" height="1080" alt="Screenshot 2026-08-26 130039" src="https://github.com/user-attachments/assets/3b26d66b-4bf2-4686-81ce-0b4151160681" />
<img width="1124" height="2026" alt="IMG_8761" src="https://github.com/user-attachments/assets/5321f9eb-64e8-457c-a23f-fd10eefd3e8b" />
<img width="1125" height="2028" alt="IMG_8762" src="https://github.com/user-attachments/assets/8ad5b024-f5a7-4248-89bb-20244a596cc7" />



## Gameplay

- Start a run with a random seed or enter a set seed
- Complete 5 rounds
- Reach each target station as quickly as possible, exploring the tube map along the way
- Complete each round in the shortest time, whilst minimising moves and line changes

## Controls

- Click/tap a direction stub to move along the selected line
- Press and drag from one stub to another, then release, to change the chosen move
- `A`/`D` or the line carousel arrow buttons: cycle through lines at an interchange

## Project Structure

```txt
src/
  data/        Network data, line definitions, validation, generated map data
  game/        Game state, seeded round generation, movement, line selection
  input/       Keyboard and pointer input handling
  rendering/   SVG map, line, station, path, and river rendering
  ui/          HUD, menus, completion screens, results
  main.ts      Application entry point
```

## Tech Stack

This game was developed using TypeScript and SVG.
