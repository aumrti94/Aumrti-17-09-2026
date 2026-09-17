# 🏥 Aumrti Complete Setup Guide

## Overview
Aumrti is an AI-First Hospital Management System built with React, TypeScript, Vite, and Supabase. This guide covers complete setup from cloning to running locally.

---

## 📋 Prerequisites

Before starting, ensure you have:
- **Node.js** v18+ or **Bun** installed
- **Git** installed
- **Supabase account** (free at https://supabase.com)
- **SendGrid account** (optional, for production emails)
- A terminal/command prompt

Check versions:
```bash
node --version  # Should be v18+
npm --version   # or bun --version
git --version
```

---

## 🚀 Part 1: Initial Setup

### 1.1 Clone Repository
```bash
cd d:/
git clone <repository-url> aumrti-hms-latest
cd aumrti-hms-latest
```

### 1.2 Install Dependencies
```bash
# Using NPM
npm install

# OR using Bun (faster)
bun install
```

### 1.3 Create Environment File

> **Credentials & projects:** all Supabase access is consolidated in **`.env.local`** (gitignored,
> untracked) — client `VITE_` creds + non-`VITE_` DB password / service_role. The personal **access
> token** is held by `supabase login` (keychain), not in any file. For standing up or migrating to a
> new project, follow **`supabase/MIGRATION_RUNBOOK.md`**.

Create `.env.local` file in root directory with:
```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here

# Leave these empty for now (can add later via UI)
VITE_ANTHROPIC_KEY=
VITE_OPENAI_KEY=
VITE_GEMINI_KEY=
VITE_PERPLEXITY_KEY=
VITE_SARVAM_KEY=
VITE_BHASHINI_KEY=

# Azure OpenAI (optional)
VITE_AZURE_OPENAI_ENDPOINT=
VITE_AZURE_OPENAI_DEPLOYMENT=
VITE_AZURE_OPENAI_API_KEY=
VITE_AZURE_OPENAI_API_VERSION=2024-02-01
```

---

## 🔑 Part 2: Supabase Configuration

### 2.1 Get Your Supabase Credentials

1. **Open Supabase Dashboard**: https://app.supabase.com/
2. **Select your project** (the active ref is recorded in `.env.local`)
3. **Go to Settings → API**
4. **Copy these values**:
   - Project URL (`https://YOUR_PROJECT_REF.supabase.co`)
   - Anon/Public Key (starts with `eyJhbGc...`)

### 2.2 Update `.env.local`

Replace placeholder with your actual Anon Key:
```env
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## 🗄️ Part 3: Database Setup

### 3.1 Run Migrations

**Option A: Using Supabase CLI (Recommended)**
```bash
# Install Supabase CLI if not already installed
npm install -g @supabase/cli

# Authenticate once (token stored in keychain, not a file), then link.
supabase login
# Link to your project (ref is in .env.local)
supabase link --project-ref YOUR_PROJECT_REF

# Apply all migrations
supabase db push
```

> Full step-by-step (token/org match, DB password, deploying edge functions) is in
> **`supabase/MIGRATION_RUNBOOK.md`**.

**Option B: Manual SQL Execution**
1. Go to Supabase Dashboard
2. Click **SQL Editor**
3. Run migrations one by one from `supabase/migrations/` folder
4. Start with earliest dated files first

### 3.2 Verify Database Tables

In Supabase **SQL Editor**, run:
```sql
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;
```

You should see tables like:
- `hospitals`
- `users`
- `patients`
- `departments`
- And many more...

---

## 👥 Part 4: Create Test User

### 4.1 Create Hospital (if not exists)

In Supabase **SQL Editor**, run:
```sql
INSERT INTO public.hospitals (name, type, state, beds_count, subscription_tier, is_active)
VALUES (
  'Test Hospital',
  'general',
  'Maharashtra',
  100,
  'professional',
  true
)
RETURNING id;
```

**Save the returned `id`** (you'll need it in next step).

### 4.2 Create Auth User

1. Go to **Authentication → Users** in Supabase
2. Click **Add User**
3. Fill in:
   - **Email**: `admin@example.com`
   - **Password**: `TestPassword123!`
   - **Confirm Password**: `TestPassword123!`
4. Click **Create User**

### 4.3 Sync User to Users Table

In Supabase **SQL Editor**, run (replace `HOSPITAL_ID` with the ID from step 4.1):
```sql
INSERT INTO public.users (id, hospital_id, full_name, email, role, is_active)
SELECT 
  id,
  'HOSPITAL_ID'::uuid,  -- Replace with actual hospital ID
  'Test Admin',
  email,
  'hospital_admin'::public.app_role,
  true
FROM auth.users
WHERE email = 'admin@example.com'
ON CONFLICT (id) DO NOTHING;
```

---

## 🎯 Part 5: Configure Authentication

### 5.1 Enable Email Provider

1. Go to **Authentication → Providers**
2. Find **Email / Magic Link** provider
3. Toggle **ON**
4. Settings:
   - **Confirm email required**: OFF (for development)
   - **Double confirm changes**: OFF

### 5.2 Configure Email Templates

1. Go to **Authentication → Email Templates**
2. Click **Reset Password**
3. Ensure redirect URL is:
   ```
   http://localhost:8080/login
   ```
   (Change for production URL when deploying)

### 5.3 (Optional) Configure SMTP for Production

For production email delivery:

1. Get **SendGrid API Key**:
   - Sign up: https://sendgrid.com/
   - Create API key in account settings

2. In Supabase, go to **Authentication → SMTP Settings**

3. Fill in:
   ```
   From Email:  noreply@yourhospital.com
   From Name:   Aumrti Hospital
   SMTP Host:   smtp.sendgrid.net
   SMTP Port:   587
   SMTP User:   apikey
   SMTP Password: [Your SendGrid API Key]
   ```

---

## ▶️ Part 6: Run the Application

### 6.1 Start Development Server

```bash
# Using NPM
npm run dev

# OR using Bun
bun run dev
```

**Output should show:**
```
  VITE v4.x.x  ready in XXX ms

  ➜  Local:   http://localhost:8080/
  ➜  press h to show help
```

### 6.2 Access Application

Open browser and go to:
```
http://localhost:8080/
```

You should see the **Aumrti Landing Page** ✅

---

## 🔐 Part 7: Test Authentication

### 7.1 Test Login

1. Click **Sign In** button on landing page
2. Enter credentials:
   - **Email**: `admin@example.com`
   - **Password**: `TestPassword123!`
3. Click **Sign In**
4. You should be redirected to **Dashboard** ✅

### 7.2 Test Password Reset

1. Go to http://localhost:8080/login
2. Click **Forgot password?**
3. Enter: `admin@example.com`
4. Check email inbox (or spam folder)
5. Click reset link and set new password ✅

### 7.3 Test Registration

1. Go to http://localhost:8080/register
2. Fill in hospital and admin details
3. Submit form
4. New hospital + admin user should be created ✅

---

## 📁 Project Structure

```
d:\aumrti-hms-latest/
├── src/
│   ├── App.tsx                 # Main routing
│   ├── components/             # UI components
│   │   ├── auth/              # Auth components
│   │   ├── layout/            # Layout components
│   │   └── ...                # Feature components
│   ├── pages/                 # Page components
│   │   ├── login/             # Login page
│   │   ├── register/          # Registration page
│   │   └── ...                # Feature pages
│   ├── hooks/                 # Custom hooks
│   ├── lib/                   # Utility functions
│   ├── contexts/              # React contexts
│   └── integrations/
│       └── supabase/          # Supabase client
├── supabase/
│   ├── migrations/            # Database migrations
│   ├── functions/             # Edge functions
│   └── config.toml            # Supabase config
├── .env.local                 # Environment variables
├── vite.config.ts             # Vite configuration
├── tsconfig.json              # TypeScript config
└── package.json               # Dependencies
```

---

## 🐛 Troubleshooting

### Issue: "Invalid credentials" on login
**Solution:**
```bash
# 1. Verify user exists in Supabase → Authentication → Users
# 2. Check .env.local has correct VITE_SUPABASE_ANON_KEY
# 3. Restart dev server:
npm run dev
# 4. Clear browser cache (Ctrl+Shift+Delete)
```

### Issue: "Cannot find module @/..." errors
**Solution:**
```bash
# Install dependencies
npm install

# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
npm run dev
```

### Issue: Blank white screen on load
**Solution:**
```bash
# 1. Check browser console (F12 → Console tab)
# 2. Verify .env.local exists and has VITE_SUPABASE_URL and KEY
# 3. Check network tab for failed requests
# 4. Restart dev server
```

### Issue: Password reset emails not arriving
**Solution:**
- Check Supabase → Authentication → Email Log
- For development: Supabase test email has 4/hour limit
- Verify SMTP configured for production
- Check spam/junk folder
- Use SendGrid for reliable delivery

### Issue: "Missing environment variable VITE_SUPABASE_URL"
**Solution:**
```bash
# Make sure .env.local exists with:
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=your-key-here

# Then restart server (changes to .env files require restart)
npm run dev
```

---

## 🧪 Development Commands

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Lint code
npm run lint
```

There is currently no automated test suite (unit or end-to-end) in this repo — it was removed
2026-09-05 pending a restart. `npm run test` / `npm run test:watch` do not exist; do not run them.
See the README for the current state and `supabase/tests/` for the one surviving suite (pgTAP,
run manually — see that directory).

---

## 📚 Key Resources

| Resource | Link |
|----------|------|
| Supabase Dashboard | https://app.supabase.com/ |
| Project SQL Editor | `https://app.supabase.com/project/<YOUR_PROJECT_REF>/sql/new` |
| Credentials | `.env.local` (gitignored) + `supabase login` keychain for the access token |
| Migration runbook | `supabase/MIGRATION_RUNBOOK.md` |
| React Docs | https://react.dev/ |
| TypeScript Docs | https://www.typescriptlang.org/ |
| Vite Docs | https://vitejs.dev/ |
| Supabase Docs | https://supabase.com/docs |
| Tailwind CSS | https://tailwindcss.com/ |

---

## ✅ Verification Checklist

Before considering setup complete:

- [ ] Dependencies installed (`npm install` completed)
- [ ] `.env.local` file created with Supabase credentials
- [ ] All database migrations ran successfully
- [ ] Test hospital created in database
- [ ] Test admin user created in Auth
- [ ] Test user synced to users table
- [ ] Email provider enabled in Supabase Auth
- [ ] Email templates configured
- [ ] Dev server running (`npm run dev`)
- [ ] Can access http://localhost:8080/ without errors
- [ ] Can login with test credentials
- [ ] Password reset works (emails arrive)
- [ ] Registration creates new hospital + user

---

## 🎉 You're All Set!

Once all items in the checklist are complete, Aumrti is ready for development. 

**Next Steps:**
1. Explore the application
2. Create more test users with different roles
3. Familiarize yourself with the features in each module
4. Review the database schema
5. Check out the `/design-system` page for UI components

**For Production Deployment:**
1. Update `.env` with production Supabase URL
2. Configure production SMTP (SendGrid)
3. Set up SSL certificates
4. Configure database backups
5. Set up monitoring and logging

---

## 📞 Support

If you encounter issues:
1. Check [Troubleshooting](#-troubleshooting) section above
2. Check browser console (F12)
3. Review Supabase logs
4. Check terminal output for errors
5. Review relevant documentation links above
