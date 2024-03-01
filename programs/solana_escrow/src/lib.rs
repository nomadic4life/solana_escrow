use anchor_lang::prelude::*;
use anchor_lang::solana_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{transfer, Mint, Token, TokenAccount, Transfer};
use core::convert::AsRef;

declare_id!("HNnEWxRvbw5Kf5oCkgTeLa1BNM4racVQELGrEn4K9GQd");

#[program]
pub mod solana_escrow {
    use super::*;

    pub fn initialize_program_signer(ctx: Context<InitializeProgramAuthority>) -> Result<()> {
        let InitializeProgramAuthority {
            new_program_authority,
            ..
        } = ctx.accounts;

        msg!(
            "New Program Authority Created: {}",
            new_program_authority.key()
        );

        new_program_authority.is_initialized = true;
        new_program_authority.is_signer = true;
        new_program_authority.seeds = String::from("signer");
        new_program_authority.bump = ctx.bumps.new_program_authority;

        return Ok(());
    }

    pub fn create_authority_token_account(
        ctx: Context<InitializeAuthorityTokenAccount>,
    ) -> Result<()> {
        msg!(
            "Created The Authority Token Account: {}",
            ctx.accounts.token_account.key()
        );

        return Ok(());
    }

    pub fn open_escrow_target_sol(
        ctx: Context<OpenEscrowAccountTargetSol>,
        data: Params,
    ) -> Result<()> {
        let OpenEscrowAccountTargetSol {
            sender,
            program_authority,
            system_program,
            new_escrow_account,
        } = ctx.accounts;

        let Params {
            amount,
            merkle_root,
            period,
            size,
        } = data;

        solana_program::program::invoke(
            &solana_program::system_instruction::transfer(
                &sender.key(),
                &program_authority.key(),
                amount,
            ),
            &[
                sender.to_account_info(),
                program_authority.to_account_info(),
                system_program.to_account_info(),
            ],
        )?;

        let clock = Clock::get()?;

        new_escrow_account.initial_date = clock.unix_timestamp;
        new_escrow_account.maturity_date = clock.unix_timestamp + 86400 * period;
        new_escrow_account.sender = sender.key();
        new_escrow_account.balance = amount;
        new_escrow_account.merkle_root = merkle_root;
        new_escrow_account.asset = AssetAccountType::Sol;

        new_escrow_account.candidates = Vec::with_capacity(size as usize);
        new_escrow_account.candidates.resize(size as usize, 0);

        new_escrow_account.is_open = true;

        return Ok(());
    }

    pub fn open_escrow_target_token(
        ctx: Context<OpenEscrowAccountTargetToken>,
        data: Params,
    ) -> Result<()> {
        let OpenEscrowAccountTargetToken {
            sender,
            new_escrow_account,
            token_program,
            sender_token,
            authority_token,
            mint,
            ..
        } = ctx.accounts;

        let Params {
            amount,
            merkle_root,
            period,
            size,
        } = data;

        transfer(
            CpiContext::new(
                token_program.to_account_info(),
                Transfer {
                    from: sender_token.to_account_info(),
                    to: authority_token.to_account_info(),
                    authority: sender.to_account_info(),
                },
            ),
            amount,
        )?;

        let clock = Clock::get()?;

        new_escrow_account.initial_date = clock.unix_timestamp;
        new_escrow_account.maturity_date = clock.unix_timestamp + 86400 * period;
        new_escrow_account.sender = sender.key();
        new_escrow_account.balance = amount;
        new_escrow_account.merkle_root = merkle_root;
        new_escrow_account.asset = AssetAccountType::Token { mint: mint.key() };

        new_escrow_account.candidates = Vec::with_capacity(size as usize);
        new_escrow_account.candidates.resize(size as usize, 0);
        new_escrow_account.is_open = true;

        return Ok(());
    }

    pub fn collect_escrow_on_sol(
        ctx: Context<CollectEscrowOnSol>,
        nodes: Vec<Pubkey>,
        ipos: u8,
    ) -> Result<()> {
        let CollectEscrowOnSol {
            escrow_account,
            program_authority,
            signer,
            ..
        } = ctx.accounts;

        if escrow_account.is_open {
            return err!(MyError::VotingInProgress);
        }

        let clock = Clock::get()?;
        if escrow_account.maturity_date > clock.unix_timestamp {
            return err!(MyError::UnlockConditionFail);
        }

        let target = 100_000_000;
        if !(escrow_account.candidates[ipos as usize - 1] > target) {
            return err!(MyError::InvalidCandidate);
        }

        let mut pos = ipos;
        let mut current = solana_program::hash::Hash::new(signer.key().as_ref());

        for node in nodes {
            let mut hash = solana_program::hash::Hasher::default();

            if pos % 2 == 0 {
                hash.hash(node.key().as_ref());
                hash.hash(current.as_ref());
            } else {
                hash.hash(current.as_ref());
                hash.hash(node.key().as_ref());
            }

            pos = pos % 2 + pos / 2;
            current = hash.result();
        }

        if current.as_ref() != escrow_account.merkle_root.as_ref() {
            return err!(MyError::UnlockConditionFail);
        }

        program_authority.sub_lamports(escrow_account.balance)?;
        signer.add_lamports(escrow_account.balance)?;

        let lamports = escrow_account.get_lamports();
        escrow_account.sub_lamports(lamports)?;
        program_authority.add_lamports(lamports)?;

        return Ok(());
    }

    pub fn collect_escrow_on_token(
        ctx: Context<CollectEscrowOnToken>,
        nodes: Vec<Pubkey>,
        ipos: u8,
    ) -> Result<()> {
        let CollectEscrowOnToken {
            escrow_account,
            program_authority,
            signer,
            recipient_token,
            authority_token,
            token_program,
            ..
        } = ctx.accounts;

        if escrow_account.is_open {
            return err!(MyError::VotingInProgress);
        }

        let clock = Clock::get()?;
        if escrow_account.maturity_date > clock.unix_timestamp {
            return err!(MyError::UnlockConditionFail);
        }

        let target = 100_000_000;
        if !(escrow_account.candidates[ipos as usize - 1] > target) {
            return err!(MyError::InvalidCandidate);
        }

        // should abstract this functionality.
        let mut pos = ipos;
        let mut current = solana_program::hash::Hash::new(signer.key().as_ref());

        for node in nodes {
            let mut hash = solana_program::hash::Hasher::default();

            if pos % 2 == 0 {
                hash.hash(node.key().as_ref());
                hash.hash(current.as_ref());
            } else {
                hash.hash(current.as_ref());
                hash.hash(node.key().as_ref());
            }

            pos = pos % 2 + pos / 2;
            current = hash.result();
        }

        if current.as_ref() != escrow_account.merkle_root.as_ref() {
            return err!(MyError::UnlockConditionFail);
        }

        let bump = program_authority.bump.to_le_bytes();
        let inner = vec!["signer".as_ref(), bump.as_ref()];
        let outer = vec![inner.as_slice()];

        transfer(
            CpiContext::new_with_signer(
                token_program.to_account_info(),
                Transfer {
                    from: authority_token.to_account_info(),
                    to: recipient_token.to_account_info(),
                    authority: program_authority.to_account_info(),
                },
                &outer,
            ),
            escrow_account.balance,
        )?;

        let lamports = escrow_account.get_lamports();
        escrow_account.sub_lamports(lamports)?;
        program_authority.add_lamports(lamports)?;

        return Ok(());
    }

    pub fn vote(ctx: Context<Vote>, pos: u8, amount: u64) -> Result<()> {
        let Vote {
            signer,
            program_authority,
            escrow_account,
            system_program,
            ..
        } = ctx.accounts;

        if !escrow_account.is_open {
            return err!(MyError::VotingIsClosed);
        }

        solana_program::program::invoke(
            &solana_program::system_instruction::transfer(
                &signer.key(),
                &program_authority.key(),
                amount,
            ),
            &[
                signer.to_account_info(),
                program_authority.to_account_info(),
                system_program.to_account_info(),
            ],
        )?;

        escrow_account.candidates[pos as usize - 1] += amount;

        let target = 100_000_000;
        if escrow_account.candidates[pos as usize - 1] > target {
            escrow_account.is_open = false
        }

        return Ok(());
    }
}

#[error_code]
pub enum MyError {
    #[msg("MyAccount may only hold data below 100")]
    DataTooLarge,

    #[msg("unlock condition is not met.")]
    UnlockConditionFail,

    #[msg("voting is closed")]
    VotingIsClosed,

    #[msg("position too large")]
    PositionTooLarge,

    #[msg("voting in progress")]
    VotingInProgress,

    #[msg("invalid candidate")]
    InvalidCandidate,
}

#[derive(Accounts)]
pub struct InitializeProgramAuthority<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = ProgramAuthority::LEN,
        seeds = [b"signer"],
        bump
    )]
    pub new_program_authority: Account<'info, ProgramAuthority>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeAuthorityTokenAccount<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        constraint = program_authority.is_initialized == true,
        seeds = [b"signer"],
        bump = program_authority.bump
    )]
    pub program_authority: Account<'info, ProgramAuthority>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = program_authority,
        associated_token::token_program = token_program,
    )]
    // authority_token
    pub token_account: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(data: Params)]
pub struct OpenEscrowAccountTargetSol<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(
        mut,
        constraint = program_authority.is_initialized == true,
        seeds = [b"signer"],
        bump = program_authority.bump
    )]
    pub program_authority: Account<'info, ProgramAuthority>,

    #[account(
        init,
        payer = sender,
        space = EscrowAccount::init(0, data.size as usize),
        seeds = [
            sender.key().as_ref(),
            data.merkle_root.as_ref(),
        ],
        bump
    )]
    pub new_escrow_account: Account<'info, EscrowAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(data: Params)]
pub struct OpenEscrowAccountTargetToken<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(
        mut,
        // could use constrait owner is the program id instead of seeds
        // would it reduce cycle use?
        constraint = program_authority.is_initialized == true,
        seeds = [b"signer"],
        bump = program_authority.bump
    )]
    pub program_authority: Account<'info, ProgramAuthority>,

    #[account(
        mut,
        constraint = sender_token.owner.key() == sender.key()
        && sender_token.mint.key() == mint.key(),
    )]
    pub sender_token: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = authority_token.owner.key() == program_authority.key()
        && authority_token.mint.key() == mint.key(),
    )]
    pub authority_token: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = sender,
        space = EscrowAccount::init(1, data.size as usize),
        seeds = [
            sender.key().as_ref(),
            data.merkle_root.as_ref(),
            mint.key().as_ref()
        ],
        bump
    )]
    pub new_escrow_account: Account<'info, EscrowAccount>,

    // could use AccountInfo instead of Account or unchecked
    pub mint: Account<'info, Mint>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CollectEscrowOnSol<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"signer"],
        bump = program_authority.bump
    )]
    pub program_authority: Account<'info, ProgramAuthority>,

    #[account(mut)]
    pub escrow_account: Account<'info, EscrowAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CollectEscrowOnToken<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"signer"],
        bump = program_authority.bump
    )]
    pub program_authority: Account<'info, ProgramAuthority>,

    #[account(
        mut,
        constraint = recipient_token.owner.key() == signer.key()
        && recipient_token.mint.key() == mint.key(),
    )]
    pub recipient_token: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = authority_token.owner.key() == program_authority.key()
        && authority_token.mint.key() == mint.key(),
    )]
    pub authority_token: Account<'info, TokenAccount>,

    #[account(mut)]
    pub escrow_account: Account<'info, EscrowAccount>,

    pub mint: Account<'info, Mint>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Vote<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"signer"],
        bump = program_authority.bump
    )]
    pub program_authority: Account<'info, ProgramAuthority>,

    #[account(mut)]
    pub escrow_account: Account<'info, EscrowAccount>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct ProgramAuthority {
    pub is_initialized: bool,
    pub is_signer: bool,
    // I dont want to use String, prefer [u8;6] but will suffice for now
    // until I figure out how to work with slice types
    pub seeds: String,
    pub bump: u8,
}

impl ProgramAuthority {
    const LEN: usize = 8 + 1 + 1 + 6 + 1 + 4;
}

#[account]
pub struct EscrowAccount {
    pub initial_date: i64,
    pub maturity_date: i64,
    pub sender: Pubkey,
    pub merkle_root: Pubkey,
    pub balance: u64,
    pub candidates: Vec<u64>,
    pub is_open: bool,
    pub asset: AssetAccountType,
}

impl EscrowAccount {
    fn init(varient: u8, size: usize) -> usize {
        match varient {
            1 => return 8 + 8 + 8 + 32 + 32 + 8 + 1 + 1 + 32 + size * 8 + 32,
            _ => return 8 + 8 + 8 + 32 + 32 + 8 + 1 + 1 + size * 8 + 32,
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum AssetAccountType {
    Sol,
    Token { mint: Pubkey },
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Params {
    pub merkle_root: Pubkey,
    pub amount: u64,
    pub period: i64,
    pub size: u64,
}
