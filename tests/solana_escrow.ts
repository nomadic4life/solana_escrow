import assert from 'assert';
import * as borsh from "@coral-xyz/borsh";
// import bs58 from "bs58";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaEscrow } from "../target/types/solana_escrow";
import { createHash } from "crypto";
import {
  createMint,
  mintTo,

  getAccount,
  getMint,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createInitializeMint2Instruction,
  createInitializeMintInstruction,
  getAssociatedTokenAddress,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  getMinimumBalanceForRentExemptMint
} from "@solana/spl-token";

const {
  sendAndConfirmTransaction,
  Transaction,
  LAMPORTS_PER_SOL,
  SystemProgram,
} = anchor.web3

class TokenAccount {
  // mint:              Pubkey
  // owner:             Pubkey
  // amount:            u64
  // delegate:          ?Pubkey
  // state:             AccountState
  // is_native:         ?u64
  // delgated_amount:   u64
  // close_authority:   ?Pubkey

  // AccountState
  //  Uninitialized:  0
  //  Initialized:    1
  //  Frozen:         2
}


class Token {
  mint: anchor.web3.Keypair;
  mintAuthority: anchor.web3.Keypair;   // optional
  freezeAuthority: anchor.web3.Keypair; // optional
  supply: number;     // u64
  decimals: number;   // u8
  isInitialized: boolean;

  createMint = async (connection: anchor.web3.Connection, payer: anchor.web3.Keypair) => {

    this.mint = anchor.web3.Keypair.generate()
    this.mintAuthority = anchor.web3.Keypair.generate()
    this.freezeAuthority = anchor.web3.Keypair.generate()
    this.supply = 0
    this.decimals = 9
    this.isInitialized = false

    const lamports = await getMinimumBalanceForRentExemptMint(connection);
    const blockhash = await connection.getLatestBlockhash()

    const transaction = new Transaction({ ...blockhash, feePayer: payer.publicKey }).add(

      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: this.mint.publicKey,
        space: MINT_SIZE,
        lamports,
        programId: TOKEN_PROGRAM_ID,
      }),

      createInitializeMintInstruction(
        this.mint.publicKey,
        this.decimals,
        this.mintAuthority.publicKey,
        this.freezeAuthority.publicKey
      )
    )


    const tx = await sendAndConfirmTransaction(connection, transaction, [payer, this.mint])

    await connection.confirmTransaction({
      ...blockhash,
      signature: tx
    }, "confirmed")

    console.log("TOKEN MINT CREATED")
  }


  airdrop = async (connection, payer, address) => {

    const associatedToken = await getAssociatedTokenAddress(
      this.mint.publicKey,
      address || payer.publicKey,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )

    const transaction = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        address || payer.publicKey,
        associatedToken,
        address || payer.publicKey,
        this.mint.publicKey,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    )

    // seems to be an issue if I use the commitment. but why? is it a bug?
    // await sendAndConfirmTransaction(connection, transaction, [payer], { commitment: "finalized" })
    const tx = await sendAndConfirmTransaction(connection, transaction, [payer])

    const blockhash = connection.getLatestBlockhash()

    await connection.confirmTransaction({
      ...blockhash,
      signature: tx
    }, "confirmed")


    const transaction2 = new Transaction().add(
      createMintToInstruction(
        this.mint.publicKey,
        associatedToken,
        this.mintAuthority.publicKey,
        100 * LAMPORTS_PER_SOL
      )
    )

    const tx2 = await sendAndConfirmTransaction(connection, transaction2, [payer, this.mintAuthority])

    const blockhash2 = connection.getLatestBlockhash()

    await connection.confirmTransaction({
      ...blockhash2,
      signature: tx2
    }, "confirmed")

    console.log("AIRDROP SUCCESS")

    return associatedToken
  }
}


class User {

  keypair: anchor.web3.Keypair | null;
  address: anchor.web3.PublicKey;
  associatedTokenAccount: anchor.web3.PublicKey;

  generate = async (connection) => {

    if (!!this.address) {
      return
    }

    const payer = anchor.web3.Keypair.generate()

    const tx = await connection.requestAirdrop(payer.publicKey, 10000 * anchor.web3.LAMPORTS_PER_SOL)
    const blockhash = await connection.getLatestBlockhash()

    await connection.confirmTransaction({
      ...blockhash,
      signature: tx,
    }, "confirmed")


    this.keypair = payer
    this.address = payer.publicKey
  }

  airdrop = async (connection, token, payer) => {
    this.associatedTokenAccount = await token.airdrop(connection, payer, this.address)
  }

  getPDA = async (connection, program, token, payer) => {
    const [signer, bump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("signer")],
      program.programId
    )

    if (!!this.address) {
      const tx = await connection.requestAirdrop(signer, 10000 * anchor.web3.LAMPORTS_PER_SOL)

      const blockhash = await connection.getLatestBlockhash()

      await connection.confirmTransaction({
        ...blockhash,
        signature: tx,
      }, "confirmed")

      this.address = signer

      // await this.airdrop(connection, token, payer)

      console.log(await connection.getBalance(signer))
    }


    return [signer, bump]
  }
}


const createMerleRoot = (list, pos) => {

  const merge = (a, b) => {
    const hash = createHash('sha256');
    hash.update(a)
    hash.update(b)

    return hash.digest()
  }

  const iterate = (list, bucket) => {
    const nodes = []

    for (let i = 1; i < list.length; i += 2) {
      nodes.push(merge(list[i - 1], list[i]))
    }

    bucket.push(nodes)
    return nodes.length
  }




  const bucket = [list]
  let size = list.length

  while (size != 1) {

    const nodes = bucket.slice(-1)[0];

    if (nodes.length % 2 !== 0) {
      nodes.push(nodes.slice(-1)[0])
    }

    size = iterate(nodes, bucket)
  }

  const nodes = []
  if (!verify(bucket, pos, nodes)) {
    return null
  }

  return nodes
}

const verify = (bucket, pos, list) => {

  const merge = (a, b) => {
    const hash = createHash('sha256');
    hash.update(a)
    hash.update(b)

    return hash.digest()
  }

  const test = []
  bucket.map(nodes => {

    let index = pos - 1

    if (pos % 2 == 0) {
      test.push({
        value: nodes[index - 1],
        target: nodes[index],
        hashed: merge(nodes[index - 1], nodes[index]),
      })

    } else if (nodes[index + 1] !== undefined) {

      test.push({
        value: nodes[index + 1],
        target: nodes[index],
        hashed: merge(nodes[index], nodes[index + 1]),
      })
    } else {
      test.push({
        value: nodes[index],
        target: nodes[index],
        hashed: nodes[index],
      })
    }

    pos = pos % 2 + Math.floor(pos / 2);
  })

  for (let i = 0; i < test.length; i++) {
    if (i !== 0 && !(test[i].target.equals(test[i - 1].hashed))) {
      return false
    }

    list.push(new anchor.web3.PublicKey(test[i].value))
  }

  return true
}

describe("solana_escrow", () => {

  anchor.setProvider(anchor.AnchorProvider.env());

  const provider = anchor.getProvider()
  const program = anchor.workspace.SolanaEscrow as Program<SolanaEscrow>;

  const token = new Token()
  const payer = new User()
  const prog = new User()

  const recipients = []


  before(async () => {


    await payer.generate(provider.connection)
    await token.createMint(provider.connection, payer.keypair)
    await payer.airdrop(provider.connection, token, payer.keypair)
    await prog.getPDA(provider.connection, program, token, payer.keypair)

    {

      const receiver = new User()
      await receiver.generate(provider.connection)
      await receiver.airdrop(provider.connection, token, receiver.keypair)

      recipients.push({
        currency: "SOL",
        receiver,
        // root: merkleRoot,
        // nodes: [payer.address],
      })
    }

    {

      const receiver = new User()
      await receiver.generate(provider.connection)
      await receiver.airdrop(provider.connection, token, receiver.keypair)

      recipients.push({
        currency: "SOL",
        receiver,
        // root: merkleRoot,
        // nodes: [payer.address],
      })
    }


    console.log("GENERATED:")
  });


  it("Is initialized!", async () => {

    const [signer] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("signer")],
      program.programId
    )


    const tx = await program.methods
      .initializeProgramSigner()
      .accounts({
        payer: payer.keypair.publicKey,
        newProgramAuthority: signer,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([payer.keypair])
      .rpc();

    const blockhash = await provider.connection.getLatestBlockhash()

    await provider.connection.confirmTransaction({
      ...blockhash,
      signature: tx,
    }, "confirmed")

    const state = await program.account.programAuthority.fetch(signer)

    assert(state.isInitialized, 'new program authority is initialized.')
    assert(state.isSigner, 'new program authority is signer.')
    assert(state.seeds == "signer", 'seeds is set')

  });


  it("Create Token Account!", async () => {

    const [signer] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("signer")],
      program.programId
    )

    const tokenAccount = await getAssociatedTokenAddress(
      token.mint.publicKey,
      signer,
      true
    )

    const tx = await program.methods
      .createAuthorityTokenAccount()
      .accounts({

        payer: payer.keypair.publicKey,
        programAuthority: signer,

        tokenAccount: tokenAccount,
        mint: token.mint.publicKey,

        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([payer.keypair])
      .rpc();


    const blockhash = await provider.connection.getLatestBlockhash()

    await provider.connection.confirmTransaction({
      ...blockhash,
      signature: tx,
    }, "confirmed")

    const state = await provider.connection.getAccountInfoAndContext(tokenAccount)
    const buffer = state.value.data
    const mint = borsh.publicKey("mint").decode(buffer)
    const owner = borsh.publicKey("owner").decode(buffer, 32)


    assert(owner.equals(signer))
    assert(mint.equals(token.mint.publicKey))

  });


  describe("", () => {

    before(async () => {
      const list = [
        recipients[0].receiver.keypair.publicKey.toBuffer(),
        anchor.web3.Keypair.generate().publicKey.toBuffer(),
        anchor.web3.Keypair.generate().publicKey.toBuffer(),
        anchor.web3.Keypair.generate().publicKey.toBuffer(),
        recipients[0].receiver.keypair.publicKey.toBuffer(),
        anchor.web3.Keypair.generate().publicKey.toBuffer(),
        anchor.web3.Keypair.generate().publicKey.toBuffer(),
        anchor.web3.Keypair.generate().publicKey.toBuffer()
      ]

      const nodes = createMerleRoot(list, 5)
      const payer = recipients[0].receiver.keypair

      const tx = await provider.connection.requestAirdrop(payer.publicKey, 1000 * anchor.web3.LAMPORTS_PER_SOL)
      const blockhash = await provider.connection.getLatestBlockhash()

      await provider.connection.confirmTransaction({
        ...blockhash,
        signature: tx,
      }, "confirmed")

      recipients[0].nodes = nodes
      recipients[0].size = list.length
      recipients[0].pos = 5
    })


    it("Create Escrow Sol Account", async () => {

      const merkleRoot = recipients[0].nodes.slice(-1)[0]

      const [escrow] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          // I don't thinkthe pay should be tied to the escrow account
          payer.keypair.publicKey.toBuffer(),
          merkleRoot.toBuffer()
        ],
        program.programId
      )


      const [signer] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("signer")],
        program.programId
      )

      const preBalance = await provider.connection.getBalance(signer)


      const tx = await program.methods
        .openEscrowTargetSol({
          amount: new anchor.BN(100 * LAMPORTS_PER_SOL),
          // period: new anchor.BN(360),
          period: new anchor.BN(0),
          merkleRoot: merkleRoot,
          size: new anchor.BN(recipients[0].size),
        })
        .accounts({
          sender: payer.keypair.publicKey,
          programAuthority: signer,
          newEscrowAccount: escrow,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([payer.keypair])
        .rpc()

      const blockhash = await provider.connection.getLatestBlockhash()

      await provider.connection.confirmTransaction({
        ...blockhash,
        signature: tx,
      }, "confirmed")


      const state = await program.account.escrowAccount.fetch(escrow)
      const postBalance = await provider.connection.getBalance(signer)

      assert(state.merkleRoot.equals(new anchor.web3.PublicKey(merkleRoot)), 'valid merkle root')
      assert(state.balance.eq(new anchor.BN(100 * LAMPORTS_PER_SOL)), "balance amount recorded")
      // assert(state.maturityDate > state.initialDate, 'maturity date set')
      assert(postBalance - preBalance == 100 * LAMPORTS_PER_SOL, 'authority SOL balance incrased')
    });


    it("Create Escrow Token Account", async () => {

      const merkleRoot = recipients[0].nodes.slice(-1)[0]

      const [escrow] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          payer.keypair.publicKey.toBuffer(),
          merkleRoot.toBuffer(),
          token.mint.publicKey.toBuffer(),
        ],
        program.programId
      )

      const [signer] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("signer")],
        program.programId
      )

      const tokenAccount = await getAssociatedTokenAddress(
        token.mint.publicKey,
        signer,
        true
      )

      const preBalance = await getAccount(provider.connection, tokenAccount)


      const tx = await program.methods
        .openEscrowTargetToken({
          amount: new anchor.BN(10 * LAMPORTS_PER_SOL),
          // period: new anchor.BN(360),
          period: new anchor.BN(0),

          merkleRoot: merkleRoot,
          size: new anchor.BN(recipients[0].size),
        })
        .accounts({
          sender: payer.keypair.publicKey,
          programAuthority: signer,
          newEscrowAccount: escrow,
          senderToken: payer.associatedTokenAccount,
          authorityToken: tokenAccount,
          mint: token.mint.publicKey,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([payer.keypair])
        .rpc()

      const blockhash = await provider.connection.getLatestBlockhash()

      await provider.connection.confirmTransaction({
        ...blockhash,
        signature: tx,
      }, "confirmed")


      const state = await program.account.escrowAccount.fetch(escrow)
      const postBalance = await getAccount(provider.connection, tokenAccount)

      assert(state.merkleRoot.equals(new anchor.web3.PublicKey(merkleRoot)), 'valid merkle root')
      assert(state.balance.eq(new anchor.BN(10 * LAMPORTS_PER_SOL)), "balance amount recorded")
      // assert(state.maturityDate > state.initialDate, 'maturity date set')
      assert(postBalance.amount > preBalance.amount, 'authority SOL balance increased')
      assert(state.asset.token.mint.equals(token.mint.publicKey), 'Valid token mint')

    });


    it("Vote -> Sol target", async () => {

      const merkleRoot = recipients[0].nodes.slice(-1)[0]

      const [signer] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("signer")],
        program.programId
      )

      const [escrow] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          payer.keypair.publicKey.toBuffer(),
          merkleRoot.toBuffer()
        ],
        program.programId
      )

      const tx = await program.methods
        .vote(
          recipients[0].pos,
          new anchor.BN(10 * LAMPORTS_PER_SOL)
        )
        .accounts({
          signer: payer.address,
          programAuthority: signer,
          escrowAccount: escrow,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer.keypair])
        .rpc()

      const blockhash = await provider.connection.getLatestBlockhash()

      await provider.connection.confirmTransaction({
        ...blockhash,
        signature: tx,
      }, "confirmed")
    })


    it("Vote -> Token target", async () => {

      const merkleRoot = recipients[0].nodes.slice(-1)[0]

      const [signer] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("signer")],
        program.programId
      )

      const [escrow] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          payer.keypair.publicKey.toBuffer(),
          merkleRoot.toBuffer(),
          token.mint.publicKey.toBuffer()
        ],
        program.programId
      )

      const tx = await program.methods
        .vote(
          recipients[0].pos,
          new anchor.BN(10 * LAMPORTS_PER_SOL)
        )
        .accounts({
          signer: payer.address,
          programAuthority: signer,
          escrowAccount: escrow,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer.keypair])
        .rpc()

      const blockhash = await provider.connection.getLatestBlockhash()

      await provider.connection.confirmTransaction({
        ...blockhash,
        signature: tx,
      }, "confirmed")
    })


    it("Collect Escrow On Sol", async () => {

      const user = recipients[0]
      const merkleRoot = recipients[0].nodes.slice(-1)[0]

      const [signer] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("signer")],
        program.programId
      )


      const [escrow] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          payer.keypair.publicKey.toBuffer(),
          merkleRoot.toBuffer()
        ],
        program.programId
      )


      const input = recipients[0].nodes.slice(0, -1)

      const tx = await program.methods
        .collectEscrowOnSol(
          input,
          recipients[0].pos
        )
        .accounts({
          signer: user.receiver.keypair.publicKey,
          programAuthority: signer,
          escrowAccount: escrow,
          systemProgram: SystemProgram.programId,
        })
        .signers([user.receiver.keypair])
        .rpc()

      const blockhash = await provider.connection.getLatestBlockhash()

      await provider.connection.confirmTransaction({
        ...blockhash,
        signature: tx,
      }, "confirmed")
    })


    it("Collect Escrow On Token", async () => {

      const user = recipients[0]
      const merkleRoot = recipients[0].nodes.slice(-1)[0]

      const [signer] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("signer")],
        program.programId
      )


      const [escrow] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          payer.keypair.publicKey.toBuffer(),
          merkleRoot.toBuffer(),
          token.mint.publicKey.toBuffer(),
        ],
        program.programId
      )

      const tokenAccount = await getAssociatedTokenAddress(
        token.mint.publicKey,
        signer,
        true
      )

      const path = recipients[0].nodes.slice(0, -1)

      const tx = await program.methods
        .collectEscrowOnToken(
          path,
          recipients[0].pos
        )
        .accounts({
          signer: user.receiver.keypair.publicKey,
          programAuthority: signer,
          escrowAccount: escrow,
          authorityToken: tokenAccount,
          recipientToken: user.receiver.associatedTokenAccount,
          mint: token.mint.publicKey,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user.receiver.keypair])
        .rpc()

      const blockhash = await provider.connection.getLatestBlockhash()

      await provider.connection.confirmTransaction({
        ...blockhash,
        signature: tx,
      }, "confirmed")
    })
  })

  describe("Validation Checks", () => {

    before(async () => {
      const pos = 5
      const list = [
        recipients[1].receiver.keypair.publicKey.toBuffer(),
        anchor.web3.Keypair.generate().publicKey.toBuffer(),
        anchor.web3.Keypair.generate().publicKey.toBuffer(),
        anchor.web3.Keypair.generate().publicKey.toBuffer(),
        recipients[1].receiver.keypair.publicKey.toBuffer(),
        anchor.web3.Keypair.generate().publicKey.toBuffer(),
        anchor.web3.Keypair.generate().publicKey.toBuffer(),
        anchor.web3.Keypair.generate().publicKey.toBuffer()
      ]

      const nodes = createMerleRoot(list, pos)
      const payer = recipients[1].receiver.keypair

      const tx = await provider.connection.requestAirdrop(payer.publicKey, 1000 * anchor.web3.LAMPORTS_PER_SOL)
      const blockhash = await provider.connection.getLatestBlockhash()

      await provider.connection.confirmTransaction({
        ...blockhash,
        signature: tx,
      }, "confirmed")

      recipients[1].nodes = nodes
      recipients[1].size = list.length
      recipients[1].pos = pos
    })

    describe("On SOL", () => {

      before(async () => {

        const merkleRoot = recipients[1].nodes.slice(-1)[0]

        const [escrow] = anchor.web3.PublicKey.findProgramAddressSync(
          [
            // I don't thinkt he payer should be tied to the escrow account
            payer.keypair.publicKey.toBuffer(),
            merkleRoot.toBuffer()
          ],
          program.programId
        )


        const [signer] = anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from("signer")],
          program.programId
        )

        const tx = await program.methods
          .openEscrowTargetSol({
            amount: new anchor.BN(100 * LAMPORTS_PER_SOL),
            // testing the period
            period: new anchor.BN(360),
            merkleRoot: merkleRoot,
            size: new anchor.BN(recipients[0].size),
          })
          .accounts({
            sender: payer.keypair.publicKey,
            programAuthority: signer,
            newEscrowAccount: escrow,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([payer.keypair])
          .rpc()

        const blockhash = await provider.connection.getLatestBlockhash()

        await provider.connection.confirmTransaction({
          ...blockhash,
          signature: tx,
        }, "confirmed")
      })

      it("VotingInProgress", async () => {

        const merkleRoot = recipients[1].nodes.slice(-1)[0]

        const [escrow] = anchor.web3.PublicKey.findProgramAddressSync(
          [
            // I don't thinkt he payer should be tied to the escrow account
            payer.keypair.publicKey.toBuffer(),
            merkleRoot.toBuffer()
          ],
          program.programId
        )


        const [signer] = anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from("signer")],
          program.programId
        )

        try {
          const user = recipients[1]

          const input = recipients[1].nodes.slice(0, -1)

          const tx = await program.methods
            .collectEscrowOnSol(
              input,
              recipients[1].pos
            )
            .accounts({
              signer: user.receiver.keypair.publicKey,
              programAuthority: signer,
              escrowAccount: escrow,
              systemProgram: SystemProgram.programId,
            })
            .signers([user.receiver.keypair])
            .rpc()

          const blockhash = await provider.connection.getLatestBlockhash()

          await provider.connection.confirmTransaction({
            ...blockhash,
            signature: tx,
          }, "confirmed")


        } catch (err) {
          assert(err.error.errorCode.code === 'VotingInProgress', 'vote in progress')
        }

      })

      describe("After Vote", () => {

        before(async () => {

          const merkleRoot = recipients[1].nodes.slice(-1)[0]

          const [signer] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("signer")],
            program.programId
          )

          const [escrow] = anchor.web3.PublicKey.findProgramAddressSync(
            [
              payer.keypair.publicKey.toBuffer(),
              merkleRoot.toBuffer(),
            ],
            program.programId
          )

          const tx = await program.methods
            .vote(
              recipients[1].pos,
              new anchor.BN(10 * LAMPORTS_PER_SOL)
            )
            .accounts({
              signer: payer.address,
              programAuthority: signer,
              escrowAccount: escrow,
              systemProgram: SystemProgram.programId,
            })
            .signers([payer.keypair])
            .rpc()

          const blockhash = await provider.connection.getLatestBlockhash()

          await provider.connection.confirmTransaction({
            ...blockhash,
            signature: tx,
          }, "confirmed")

        })

        it("VotingIsClosed", async () => {

          const merkleRoot = recipients[1].nodes.slice(-1)[0]

          const [signer] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("signer")],
            program.programId
          )

          const [escrow] = anchor.web3.PublicKey.findProgramAddressSync(
            [
              payer.keypair.publicKey.toBuffer(),
              merkleRoot.toBuffer(),
            ],
            program.programId
          )

          try {

            const tx = await program.methods
              .vote(
                recipients[1].pos,
                new anchor.BN(10 * LAMPORTS_PER_SOL)
              )
              .accounts({
                signer: payer.address,
                programAuthority: signer,
                escrowAccount: escrow,
                systemProgram: SystemProgram.programId,
              })
              .signers([payer.keypair])
              .rpc()

            const blockhash = await provider.connection.getLatestBlockhash()

            await provider.connection.confirmTransaction({
              ...blockhash,
              signature: tx,
            }, "confirmed")

          } catch (err) {
            assert(err.error.errorCode.code === 'VotingIsClosed', 'Voting session is clossed')
          }



        })

        it("InvalidCandidate", async () => {

          const user = recipients[1]
          const input = recipients[1].nodes.slice(0, -1)
          const merkleRoot = recipients[1].nodes.slice(-1)[0]

          const [escrow] = anchor.web3.PublicKey.findProgramAddressSync(
            [
              // I don't thinkt he payer should be tied to the escrow account
              payer.keypair.publicKey.toBuffer(),
              merkleRoot.toBuffer()
            ],
            program.programId
          )


          const [signer] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("signer")],
            program.programId
          )


          try {

            const tx = await program.methods
              .collectEscrowOnSol(
                input,
                recipients[1].pos + 1
              )
              .accounts({
                signer: user.receiver.keypair.publicKey,
                programAuthority: signer,
                escrowAccount: escrow,
                systemProgram: SystemProgram.programId,
              })
              .signers([user.receiver.keypair])
              .rpc()

            const blockhash = await provider.connection.getLatestBlockhash()

            await provider.connection.confirmTransaction({
              ...blockhash,
              signature: tx,
            }, "confirmed")


          } catch (err) {
            assert(err.error.errorCode.code === 'InvalidCandidate', 'Invalid Candidate')
          }

        })

        it("UnlockConditionFail", async () => {

          const user = recipients[1]
          const input = recipients[1].nodes.slice(0, -1)
          const merkleRoot = recipients[1].nodes.slice(-1)[0]

          const [escrow] = anchor.web3.PublicKey.findProgramAddressSync(
            [
              // I don't thinkt he payer should be tied to the escrow account
              payer.keypair.publicKey.toBuffer(),
              merkleRoot.toBuffer()
            ],
            program.programId
          )


          const [signer] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("signer")],
            program.programId
          )


          try {

            const tx = await program.methods
              .collectEscrowOnSol(
                input,
                recipients[1].pos
              )
              .accounts({
                signer: user.receiver.keypair.publicKey,
                programAuthority: signer,
                escrowAccount: escrow,
                systemProgram: SystemProgram.programId,
              })
              .signers([user.receiver.keypair])
              .rpc()

            const blockhash = await provider.connection.getLatestBlockhash()

            await provider.connection.confirmTransaction({
              ...blockhash,
              signature: tx,
            }, "confirmed")


          } catch (err) {
            assert(err.error.errorCode.code === 'UnlockConditionFail', 'Escrow Account has not reached Maturity Date')
          }

        })
      })


    })


    describe("On Token", () => {

      before(async () => {

        const merkleRoot = recipients[1].nodes.slice(-1)[0]

        const [escrow] = anchor.web3.PublicKey.findProgramAddressSync(
          [
            payer.keypair.publicKey.toBuffer(),
            merkleRoot.toBuffer(),
            token.mint.publicKey.toBuffer(),
          ],
          program.programId
        )

        const [signer] = anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from("signer")],
          program.programId
        )

        const tokenAccount = await getAssociatedTokenAddress(
          token.mint.publicKey,
          signer,
          true
        )


        const tx = await program.methods
          .openEscrowTargetToken({
            amount: new anchor.BN(1 * LAMPORTS_PER_SOL),
            period: new anchor.BN(360),

            merkleRoot: merkleRoot,
            size: new anchor.BN(recipients[1].size),
          })
          .accounts({
            sender: payer.keypair.publicKey,
            programAuthority: signer,
            newEscrowAccount: escrow,
            senderToken: payer.associatedTokenAccount,
            authorityToken: tokenAccount,
            mint: token.mint.publicKey,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([payer.keypair])
          .rpc()

        const blockhash = await provider.connection.getLatestBlockhash()

        await provider.connection.confirmTransaction({
          ...blockhash,
          signature: tx,
        }, "confirmed")

      })

      it("VotingInProgress", async () => {

        const user = recipients[1]
        const merkleRoot = recipients[1].nodes.slice(-1)[0]
        const input = recipients[1].nodes.slice(0, -1)

        const [escrow] = anchor.web3.PublicKey.findProgramAddressSync(
          [
            // I don't thinkt he payer should be tied to the escrow account
            payer.keypair.publicKey.toBuffer(),
            merkleRoot.toBuffer(),
            token.mint.publicKey.toBuffer()
          ],
          program.programId
        )


        const [signer] = anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from("signer")],
          program.programId
        )


        const tokenAccount = await getAssociatedTokenAddress(
          token.mint.publicKey,
          signer,
          true
        )


        try {

          const tx = await program.methods
            .collectEscrowOnToken(
              input,
              recipients[1].pos
            )
            .accounts({
              signer: user.receiver.keypair.publicKey,
              programAuthority: signer,
              escrowAccount: escrow,
              recipientToken: user.receiver.associatedTokenAccount,
              authorityToken: tokenAccount,
              mint: token.mint.publicKey,
              associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
              tokenProgram: TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .signers([user.receiver.keypair])
            .rpc()

          const blockhash = await provider.connection.getLatestBlockhash()

          await provider.connection.confirmTransaction({
            ...blockhash,
            signature: tx,
          }, "confirmed")


        } catch (err) {
          assert(err.error.errorCode.code === 'VotingInProgress', 'vote in progress')
        }

      })

      describe("After Vote", () => {

        before(async () => {

          const merkleRoot = recipients[1].nodes.slice(-1)[0]

          const [signer] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("signer")],
            program.programId
          )

          const [escrow] = anchor.web3.PublicKey.findProgramAddressSync(
            [
              payer.keypair.publicKey.toBuffer(),
              merkleRoot.toBuffer(),
              token.mint.publicKey.toBuffer()
            ],
            program.programId
          )

          const tx = await program.methods
            .vote(
              recipients[1].pos,
              new anchor.BN(10 * LAMPORTS_PER_SOL)
            )
            .accounts({
              signer: payer.address,
              programAuthority: signer,
              escrowAccount: escrow,
              systemProgram: SystemProgram.programId,
            })
            .signers([payer.keypair])
            .rpc()

          const blockhash = await provider.connection.getLatestBlockhash()

          await provider.connection.confirmTransaction({
            ...blockhash,
            signature: tx,
          }, "confirmed")

        })

        it("VotingIsClosed", async () => {

          const merkleRoot = recipients[1].nodes.slice(-1)[0]

          const [signer] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("signer")],
            program.programId
          )

          const [escrow] = anchor.web3.PublicKey.findProgramAddressSync(
            [
              payer.keypair.publicKey.toBuffer(),
              merkleRoot.toBuffer(),
            ],
            program.programId
          )

          try {

            const tx = await program.methods
              .vote(
                recipients[1].pos,
                new anchor.BN(10 * LAMPORTS_PER_SOL)
              )
              .accounts({
                signer: payer.address,
                programAuthority: signer,
                escrowAccount: escrow,
                systemProgram: SystemProgram.programId,
              })
              .signers([payer.keypair])
              .rpc()

            const blockhash = await provider.connection.getLatestBlockhash()

            await provider.connection.confirmTransaction({
              ...blockhash,
              signature: tx,
            }, "confirmed")

          } catch (err) {
            assert(err.error.errorCode.code === 'VotingIsClosed', 'Voting session is clossed')
          }



        })

        it("InvalidCandidate", async () => {

          const user = recipients[1]
          const input = recipients[1].nodes.slice(0, -1)
          const merkleRoot = recipients[1].nodes.slice(-1)[0]

          const [escrow] = anchor.web3.PublicKey.findProgramAddressSync(
            [
              // I don't thinkt he payer should be tied to the escrow account
              payer.keypair.publicKey.toBuffer(),
              merkleRoot.toBuffer(),
              token.mint.publicKey.toBuffer()
            ],
            program.programId
          )


          const [signer] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("signer")],
            program.programId
          )


          const tokenAccount = await getAssociatedTokenAddress(
            token.mint.publicKey,
            signer,
            true
          )



          try {

            const tx = await program.methods
              .collectEscrowOnToken(
                input,
                recipients[1].pos + 1
              )
              .accounts({
                signer: user.receiver.keypair.publicKey,
                programAuthority: signer,
                escrowAccount: escrow,
                recipientToken: user.receiver.associatedTokenAccount,
                authorityToken: tokenAccount,
                mint: token.mint.publicKey,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
              })
              .signers([user.receiver.keypair])
              .rpc()

            const blockhash = await provider.connection.getLatestBlockhash()

            await provider.connection.confirmTransaction({
              ...blockhash,
              signature: tx,
            }, "confirmed")


          } catch (err) {
            assert(err.error.errorCode.code === 'InvalidCandidate', 'Invalid Candidate')
          }

        })

        it("UnlockConditionFail", async () => {

          const user = recipients[1]
          const input = recipients[1].nodes.slice(0, -1)
          const merkleRoot = recipients[1].nodes.slice(-1)[0]

          const [escrow] = anchor.web3.PublicKey.findProgramAddressSync(
            [
              // I don't thinkt he payer should be tied to the escrow account
              payer.keypair.publicKey.toBuffer(),
              merkleRoot.toBuffer(),
              token.mint.publicKey.toBuffer()
            ],
            program.programId
          )


          const [signer] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("signer")],
            program.programId
          )


          const tokenAccount = await getAssociatedTokenAddress(
            token.mint.publicKey,
            signer,
            true
          )



          try {

            const tx = await program.methods
              .collectEscrowOnToken(
                input,
                recipients[1].pos
              )
              .accounts({
                signer: user.receiver.keypair.publicKey,
                programAuthority: signer,
                escrowAccount: escrow,
                recipientToken: user.receiver.associatedTokenAccount,
                authorityToken: tokenAccount,
                mint: token.mint.publicKey,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
              })
              .signers([user.receiver.keypair])
              .rpc()

            const blockhash = await provider.connection.getLatestBlockhash()

            await provider.connection.confirmTransaction({
              ...blockhash,
              signature: tx,
            }, "confirmed")


          } catch (err) {
            assert(err.error.errorCode.code === 'UnlockConditionFail', 'Escrow Account has not reached Maturity Date')
          }

        })
      })

    })

  })

});