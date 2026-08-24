# Rush Hour

A speedrunning game where you traverse the London Underground (and Elizabeth line) network as quickly as possible, from a random start to a destination station.

## Screenshots

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/bdc989d1-222d-498f-92a2-8a3ed9a3f479" />

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/398e1c9e-a606-4edd-a5bd-0e93d68fecaf" />

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/f849125a-8749-48ef-abfa-51bef1314db8" />

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/f0f945e5-4ffb-47f8-bf77-d31b15ab02e3" />

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/1251205e-1423-47f2-bdc6-4bc051b454e5" />

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
