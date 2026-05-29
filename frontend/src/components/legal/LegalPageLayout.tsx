import type { ReactNode } from 'react';

interface LegalPageLayoutProps {
  title: string;
  updatedAt: string;
  intro: string;
  children: ReactNode;
}

export default function LegalPageLayout({
  title,
  updatedAt,
  intro,
  children,
}: LegalPageLayoutProps) {
  return (
    <div className="flex-1 overflow-y-auto bg-[#0f1117] px-4 py-8 text-[#d1d4dc] sm:px-6 lg:px-8">
      <section className="mx-auto w-full max-w-4xl rounded-lg border border-[#3f4654] bg-[#10141c] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.25)] sm:p-8">
        <div className="mb-8 border-b border-[#3f4654] pb-6">
          <p className="mb-3 text-sm font-medium text-blue-400">
            Last updated: {updatedAt}
          </p>
          <h1 className="text-3xl font-bold text-white sm:text-4xl">{title}</h1>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-[#d1d4dc]/80 sm:text-base">
            {intro}
          </p>
        </div>

        <div className="space-y-7 text-sm leading-6 text-[#d1d4dc]/85 sm:text-base sm:leading-7">
          {children}
        </div>
      </section>
    </div>
  );
}

