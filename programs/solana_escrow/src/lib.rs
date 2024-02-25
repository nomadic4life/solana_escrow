use anchor_lang::prelude::*;

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
}

#[derive(Accounts)]
pub struct InitializeProgramAuthority<'info> {
    // payer
    // new program authority
    // system program
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
