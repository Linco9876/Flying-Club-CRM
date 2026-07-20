import React from 'react';
import { Download, ShieldCheck, Smartphone } from 'lucide-react';

const APK_DOWNLOAD_URL =
  'https://github.com/Linco9876/Flying-Club-CRM/releases/download/duty-clock-v1.0.0/BFC-Duty-Clock-1.0.0.apk';

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

          <p className="text-sm font-semibold text-sky-300">Android app</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">BFC Duty Clock</h1>
          <p className="mt-4 text-base leading-7 text-slate-300">
            Clock on, record breaks and end your duty period from your Android phone. Sign in with your existing portal account.
          </p>

          <a
            href={APK_DOWNLOAD_URL}
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-sky-400 px-5 py-4 text-base font-bold text-slate-950 transition hover:bg-sky-300 focus:outline-none focus:ring-4 focus:ring-sky-300/40"
          >
            <Download className="h-5 w-5" aria-hidden="true" />
            Download for Android
          </a>

          <div className="mt-5 flex items-start gap-3 rounded-xl border border-emerald-300/20 bg-emerald-300/10 p-4 text-sm leading-6 text-emerald-100">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" />
            <p>Version 1.0.0 is digitally signed by Bendigo Flying Club and has passed Android signature verification.</p>
          </div>
        </div>

        <div className="border-t border-white/10 bg-black/15 px-6 py-5 text-sm leading-6 text-slate-300 sm:px-9">
          <p className="font-semibold text-white">Installation</p>
          <p className="mt-1">
            Open the downloaded APK and follow Android's prompts. The first installation may ask you to allow installs from your browser or Files app.
          </p>
        </div>
      </section>
    </div>
  </main>
);

export default DutyClockDownloadPage;
