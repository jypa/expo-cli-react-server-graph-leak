# Expo CLI keeps every react-server graph of an API route

A stock SDK 58 app (`create-expo-app --template blank-typescript@sdk-58`) with `expo-router`, server output,
`experiments.reactServerFunctions: true` and four API routes that import `lib/message.ts`.

```bash
npm install
npm run measure
```

`measure.mjs` starts `expo start --port 8199` under the Node inspector. It edits `lib/message.ts` 10 times and
requests each route after each edit. After each round, it prints the heap and the number of graphs that Metro keeps.

On `@expo/cli` 58.1.21 the graphs go from 4 to 44. With `reactServerFunctions` off, they stay at 4.
