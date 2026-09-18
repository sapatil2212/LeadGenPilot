# Next.js Landing Page - Setup Guide

## ✅ Current Setup

Your application is **already configured** to use Next.js for the landing page!

### Architecture

```
NexaLeadAi Server (Port 3000)
├─ /                    → Next.js Landing Page (from leadfinder-landing/out)
├─ /app                 → React Dashboard (from dist)
└─ /api/*               → Backend API Routes
```

### File Structure

```
leadfinder-ai/
├── leadfinder-landing/     # Next.js Landing Page
│   ├── src/
│   │   ├── app/
│   │   │   └── page.tsx    # Main landing page
│   │   └── components/     # All landing components
│   ├── out/                # Built static files (served by Express)
│   └── package.json
│
├── src/                    # React Dashboard
│   └── App.tsx             # Main dashboard
├── dist/                   # Built dashboard files
└── server.ts               # Express server (serves both)
```

---

## 🚀 How to Use

### Development Mode

**Option 1: Run Full Stack**
```bash
# Terminal 1: Start main server (serves dashboard + API)
npm run dev

# Terminal 2: Start Next.js dev server with HMR
cd leadfinder-landing
npm run dev
```

Then access:
- **Landing Page**: http://localhost:3001 (Next.js dev server with HMR)
- **Dashboard**: http://localhost:3000/app (Main server)
- **API**: http://localhost:3000/api/* (Main server)

**Option 2: Run Production Build Locally**
```bash
# Build both apps
npm run build

# Start server (serves both landing + dashboard)
npm run start
```

Then access:
- **Landing Page**: http://localhost:3000/
- **Dashboard**: http://localhost:3000/app
- **API**: http://localhost:3000/api/*

### Production Deployment

```bash
# Build everything
npm run build

# Start server
npm run start
```

Both landing page and dashboard are served from the same server on port 3000.

---

## 🔧 Build Process

### Building the Landing Page

```bash
cd leadfinder-landing
npm run build
```

This creates static files in `leadfinder-landing/out/` directory.

**Build Configuration:**

The landing page uses Next.js static export (no Node.js server required):

```typescript
// leadfinder-landing/next.config.ts
const nextConfig = {
  output: 'export',  // Static HTML export
  images: {
    unoptimized: true,
  },
};
```

### Building the Dashboard

```bash
npm run build
```

This builds:
1. Vite (React dashboard) → `dist/`
2. Server (Express backend) → `dist/server.cjs`

---

## 🎨 Customizing the Landing Page

### Components Location

All landing page components are in:
```
leadfinder-landing/src/components/
├── Navbar.tsx          # Navigation with logo
├── Hero.tsx            # Hero section
├── Stats.tsx           # Statistics section
├── Features.tsx        # Features grid
├── HowItWorks.tsx      # 3-step process
├── Scoring.tsx         # AI scoring showcase
├── Testimonials.tsx    # Customer testimonials
├── Pricing.tsx         # Pricing plans
├── FAQ.tsx             # FAQ accordion
├── CTABanner.tsx       # Call-to-action
├── Footer.tsx          # Footer with logo
├── HeroDashboard.tsx   # Dashboard mockup
└── DashboardMockup.tsx # Interactive preview
```

### Logo Updates

The logo is already integrated in:
- ✅ Navbar
- ✅ Footer
- ✅ Dashboard mockups

Logo file: `leadfinder-landing/public/logo.png`

### Styling

Global styles: `leadfinder-landing/src/app/globals.css`

Uses:
- **Tailwind CSS** for utility classes
- **Custom gradients** for brand colors
- **Responsive design** (mobile-first)

---

## 🔗 Navigation Links

### Current Links in Landing Page

**Navbar:**
- Features → `#features`
- Pricing → `#pricing`
- FAQ → `#faq`
- **Log In** → `/app?mode=signin` ✅
- **Get Started Free** → `/app?mode=signup` ✅

**Hero Section:**
- **Start Finding Leads** → `/app` ✅
- See How It Works → `#features`

**CTA Buttons:**
- Various "Get Started" buttons → `/app` ✅

### Adding New Links

To link to the dashboard from landing page:

```tsx
// Internal link to dashboard
<a href="/app">Go to Dashboard</a>

// Link with query params
<a href="/app?mode=signup">Sign Up</a>
<a href="/app?mode=signin">Log In</a>

// Using Next.js Link component
import Link from 'next/link';
<Link href="/app">Dashboard</Link>
```

---

## 📦 Dependencies

### Landing Page (Next.js)

```json
{
  "next": "^15.2.2",
  "react": "^19.0.0",
  "react-dom": "^19.0.0",
  "lucide-react": "^0.469.0"
}
```

### Dashboard (React + Vite)

```json
{
  "react": "^19.0.0",
  "react-dom": "^19.0.0",
  "vite": "^6.4.3"
}
```

---

## 🐛 Troubleshooting

### Landing Page Not Showing

**Check build exists:**
```bash
ls leadfinder-landing/out/index.html
```

If missing:
```bash
cd leadfinder-landing
npm run build
cd ..
```

### Dashboard Not Loading at /app

**Check dashboard build:**
```bash
ls dist/index.html
```

If missing:
```bash
npm run build
```

### Port Conflicts

If port 3000 is in use:

**Change in `.env`:**
```env
PORT=3001
```

Or run directly:
```bash
PORT=3001 npm run start
```

### Hot Module Replacement (HMR) Not Working

For development with HMR on landing page:

```bash
# Terminal 1: Main server (dashboard + API)
npm run dev

# Terminal 2: Next.js with HMR
cd leadfinder-landing
npm run dev
```

Access Next.js dev server at http://localhost:3001 for HMR.

### Build Errors

**Clear caches and rebuild:**
```bash
# Clean Next.js cache
cd leadfinder-landing
rm -rf .next out
npm run build
cd ..

# Clean dashboard cache
rm -rf dist
npm run build
```

---

## 🔄 Updating Content

### 1. Edit Landing Page Content

```bash
cd leadfinder-landing/src/components
# Edit the component you want to change
# For example: nano Hero.tsx
```

### 2. Rebuild Landing Page

```bash
cd leadfinder-landing
npm run build
cd ..
```

### 3. Restart Server

```bash
npm run start
```

Your changes will be live at http://localhost:3000/

---

## 📊 Server Routing Logic

### Production Mode

```typescript
// In server.ts (line ~955)
app.get("*", (req, res) => {
  const landingHtmlPath = path.join(nextOutPath, "index.html");
  
  if (req.path === "/" && fs.existsSync(landingHtmlPath)) {
    // Serve Next.js landing page at root
    res.sendFile(landingHtmlPath);
  } else {
    // Serve React dashboard for /app and other routes
    res.sendFile(path.join(distPath, "index.html"));
  }
});
```

### Static Assets

```typescript
// Serve Next.js static files (CSS, JS, images)
app.use(express.static(nextOutPath));

// Serve dashboard static files
app.use(express.static(distPath));
```

---

## 🎯 Benefits of Next.js Landing Page

✅ **SEO Optimized** - Static HTML for better search rankings
✅ **Fast Loading** - Pre-rendered at build time
✅ **Modern Stack** - Latest React 19 + Next.js 15
✅ **Easy Updates** - Component-based architecture
✅ **Type Safe** - Full TypeScript support
✅ **Responsive** - Mobile-first design with Tailwind
✅ **Same Server** - No separate hosting needed

---

## 📝 Quick Commands Reference

```bash
# Development (with HMR)
cd leadfinder-landing && npm run dev

# Build landing page only
cd leadfinder-landing && npm run build

# Build everything (landing + dashboard + server)
npm run build

# Start production server
npm run start

# Clean rebuild
rm -rf leadfinder-landing/.next leadfinder-landing/out dist
npm run build
```

---

## 🚀 Deployment Checklist

Before deploying to production:

- [ ] Build landing page: `cd leadfinder-landing && npm run build`
- [ ] Build dashboard: `npm run build`
- [ ] Test locally: `npm run start`
- [ ] Verify landing page: http://localhost:3000/
- [ ] Verify dashboard: http://localhost:3000/app
- [ ] Check all navigation links work
- [ ] Test authentication flow
- [ ] Verify API endpoints
- [ ] Check mobile responsiveness
- [ ] Test logo displays correctly

---

## 💡 Tips

### Fast Development Workflow

1. **Landing Page Changes:**
   ```bash
   cd leadfinder-landing
   npm run dev  # HMR at port 3001
   ```

2. **Dashboard Changes:**
   ```bash
   npm run dev  # HMR at port 3000
   ```

3. **Backend Changes:**
   Edit `server.ts` or files in `src/`, then:
   ```bash
   npm run build
   npm run start
   ```

### Logo Consistency

Both landing page and dashboard use the same logo:
- **Landing**: `leadfinder-landing/public/logo.png`
- **Dashboard**: `public/logo.png`

Keep them in sync or use the same file.

---

## 📚 Documentation

- **Next.js Docs**: https://nextjs.org/docs
- **Tailwind CSS**: https://tailwindcss.com/docs
- **Lucide Icons**: https://lucide.dev/icons
- **React 19**: https://react.dev/

---

**Your Next.js landing page is ready to go! 🎉**

Simply run `npm run start` and access:
- Landing: http://localhost:3000/
- Dashboard: http://localhost:3000/app
