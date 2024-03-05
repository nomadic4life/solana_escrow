# Solana Escrow Contract

A user can create an escrow account to lock up any amount of an asset for a specified recipient or recipients, under a specifed condition.

## Description

an escrow account can be created from any user "sender", and the sender will specific the amount, conditions, and possible recipients. the recipient can be a single user, or a group of users or a undeterministic set of users. A merkle tree is used to keep track of the group of users.

the recipients that meets the set of conditions can collect their assets from the escrow account using the hash of their address and all the possible hash nodes that will be hash to match the given merkle root.

## Getting Started

### Executing program [TEST]

* run tests
```
anchor test
```

## Authors

Contributors names and contact info

Dennis Orbison 
[@Freedom_pk_life](https://twitter.com/Freedom_pk_live)


## License

This project is licensed under the MIT License - see the LICENSE.md file for details