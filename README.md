# Rush Hour

A speedrunning game where you traverse the London Underground (and Elizabeth line) network as quickly as possible, from a random start to a destination station.

## Screenshots

<img width="1920" height="1080" alt="Screenshot 2026-07-31 184930" src="https://github.com/user-attachments/assets/e6173e97-9c64-4a63-8f0e-185cdf38d324" />
<img width="1920" height="1080" alt="Screenshot 2026-07-31 185053" src="https://github.com/user-attachments/assets/f275e820-da9c-49a5-b52b-149c66676629" />
<img width="1920" height="1080" alt="Screenshot 2026-07-31 185154" src="https://github.com/user-attachments/assets/f33c5b37-5e45-49d2-a299-8c9570afa70a" />
<img width="1920" height="1080" alt="Screenshot 2026-07-31 185729" src="https://github.com/user-attachments/assets/49b1995d-2c9b-4901-960f-df79861e393c" />
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/1251205e-1423-47f2-bdc6-4bc051b454e5" />
<img width="1920" height="1080" alt="Screenshot 2026-07-31 185019" src="https://github.com/user-attachments/assets/0cfdb93b-1f3f-4140-9e0f-9f0a8a7b6394" />

## Gameplay

- Start a run with a random seed or enter a set seed
- Complete 5 rounds
- Reach each target station as quickly as possible, exploring the tube map along the way
- Complete each round in the shortest time, whilst minimising moves and line changes

## Controls

- `A`/`D`: cycle to the previous and next available line at the current station
- Move the mouse pointer around the current station to choose a direction
- Left click to move in a given direction

## Project Structure

```txt
src/
  data/        Network data, line definitions, validation, generated map data
  game/        Game state, seeded round generation, movement, line selection
  input/       Keyboard and pointer intent handling
  rendering/   SVG map, line, station, path, and river rendering
  ui/          HUD, menus, completion screens, results
  main.ts      Application entry point
```

## Tech Stack

This game was developed using TypeScript and the HTML Canvas.
