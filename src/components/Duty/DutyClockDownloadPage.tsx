import React from 'react';
import { Download, ShieldCheck, Smartphone } from 'lucide-react';

export const DutyClockDownloadPage: React.FC = () => (
  <main className="min-h-screen bg-slate-950 px-4 py-10 text-white sm:px-6 sm:py-16">
    <div className="mx-auto max-w-xl">
      <div className="mb-8 flex items-center gap-3">
        <img src="/favicon.svg" alt="Bendigo Flying Club" className="h-12 w-12" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-300">Bendigo Flying Club</p>
          <p className="mt-1 text-sm text-slate-300">Instructor tools</p>
        </div>
      </div>

      <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.07] shadow-2xl shadow-black/30 backdrop-blur">
        <div className="p-6 sm:p-9">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-400/15 text-sky-300">
            <Smartphone className="h-8 w-8" aria-hidden="true" />
          </div>

          <p className="text-sm font-semibold text-sky-300">Installable web app</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">BFC Duty Clock</h1>
          <p className="mt-4 text-base leading-7 text-slate-300">
            Clock on, record breaks and end your duty period from any modern phone. It updates automatically and uses your existing portal account.
          </p>

          <a
            href="/duty-clock/app/"
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-sky-400 px-5 py-4 text-base font-bold text-slate-950 transition hover:bg-sky-300 focus:outline-none focus:ring-4 focus:ring-sky-300/40"
          >
            <Download className="h-5 w-5" aria-hidden="true" />
            Open Duty Clock
          </a>
          <p className="mt-3 text-center text-xs leading-5 text-slate-400">
            Works on iPhone, iPad, Android and desktop. Open it, then choose Add to Home Screen or Install.
          </p>

          <div className="mt-5 flex items-start gap-3 rounded-xl border border-emerald-300/20 bg-emerald-300/10 p-4 text-sm leading-6 text-emerald-100">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" />
            <p>No APK or app-store download is required. The secure PWA is served from the club portal and receives updates automatically.</p>
          </div>
        </div>

        <div className="border-t border-white/10 bg-black/15 px-6 py-5 text-sm leading-6 text-slate-300 sm:px-9">
          <p className="font-semibold text-white">Add it to your phone</p>
          <p className="mt-1">
            iPhone or iPad: open in Safari, tap Share, then Add to Home Screen. Android: open the browser menu and choose Install app.
          </p>
        </div>
      </section>
    </div>
  </main>
);

export default DutyClockDownloadPage;
