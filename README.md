## Run test && coverage

```
# start ganache in another window
npm run ganache-local-development
# then run coverage
npm run coverage
```

## Deploy to Ropsten

```
INFURA_MNEMONIC="nmemonic" INFURA_PROJECT_SECRET="secret" INFURA_PROJECT_ID="id" npx truffle deploy --network ropsten
```

## Build artifact
```
npm run compile
npm run clean-contracts
npm pack
```

## License

P2pim Contracts is released under the [MIT License](LICENSE).
