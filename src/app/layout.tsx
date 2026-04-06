import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Penney Construction",
  description: "Pre-Construction & Estimating Platform",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Penney Construction",
    startupImage: "/logo.jpg",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        {/* Inline splash screen — renders before JS loads */}
        <div
          id="splash"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#000",
            transition: "opacity 0.4s ease-out",
          }}
        >
          <style dangerouslySetInnerHTML={{ __html: `
            @keyframes splashGlow { 0%,100%{opacity:.3;transform:scale(1)} 50%{opacity:.6;transform:scale(1.05)} }
            @keyframes splashScan { 0%{top:-2px;opacity:0} 10%{opacity:1} 90%{opacity:1} 100%{top:100%;opacity:0} }
            @keyframes splashReveal { from{opacity:0;transform:scale(.92) translateY(8px)} to{opacity:1;transform:scale(1) translateY(0)} }
            @keyframes splashBar { 0%{width:0;margin-left:0} 50%{width:60%;margin-left:20%} 100%{width:0;margin-left:100%} }
            @keyframes splashRing { from{transform:rotate(0)} to{transform:rotate(360deg)} }
            #splash-glow{animation:splashGlow 2.5s ease-in-out infinite}
            #splash-scan{animation:splashScan 2s ease-in-out infinite}
            #splash-logo{animation:splashReveal .7s ease-out both}
            #splash-text{animation:splashReveal .7s ease-out .25s both}
            #splash-bar-inner{animation:splashBar 1.2s ease-in-out infinite}
            #splash-ring1{animation:splashRing 3s linear infinite}
            #splash-ring2{animation:splashRing 4s linear infinite reverse}
            #splash.hide{opacity:0;pointer-events:none}
          `}} />
          {/* Glow */}
          <div id="splash-glow" style={{position:"absolute",width:350,height:350,borderRadius:"50%",background:"radial-gradient(circle,rgba(217,119,6,.15),transparent 70%)"}} />
          {/* Scan line */}
          <div style={{position:"absolute",inset:0,overflow:"hidden"}}>
            <div id="splash-scan" style={{position:"absolute",left:0,right:0,height:2,background:"linear-gradient(90deg,transparent,rgba(217,119,6,.5),transparent)"}} />
          </div>
          {/* Logo group */}
          <div id="splash-logo" style={{position:"relative",display:"flex",flexDirection:"column",alignItems:"center",gap:20}}>
            {/* Rings */}
            <div style={{position:"relative"}}>
              <div id="splash-ring1" style={{position:"absolute",inset:-16,borderRadius:"50%",border:"1px solid rgba(217,119,6,.2)"}} />
              <div id="splash-ring2" style={{position:"absolute",inset:-32,borderRadius:"50%",border:"1px solid rgba(217,119,6,.1)"}} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.jpg" alt="Penney Construction" width={180} height={120} style={{position:"relative",zIndex:1,filter:"drop-shadow(0 0 25px rgba(217,119,6,.3))"}} />
            </div>
          </div>
          {/* Text + bar */}
          <div id="splash-text" style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8,marginTop:24}}>
            <p style={{fontSize:11,fontFamily:"monospace",textTransform:"uppercase",letterSpacing:"0.35em",color:"rgba(217,119,6,.7)",margin:0}}>Command Center</p>
            <div style={{width:128,height:2,borderRadius:2,background:"rgba(255,255,255,.05)",overflow:"hidden",marginTop:8}}>
              <div id="splash-bar-inner" style={{height:"100%",borderRadius:2,background:"linear-gradient(90deg,#b45309,#f59e0b)"}} />
            </div>
          </div>
        </div>
        <ThemeProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            var s=document.getElementById('splash');
            if(!s)return;
            function hide(){s.classList.add('hide');setTimeout(function(){s.remove()},500)}
            window.addEventListener('load',function(){setTimeout(hide,600)});
            setTimeout(hide,5000);
          })();
        `}} />
      </body>
    </html>
  );
}
