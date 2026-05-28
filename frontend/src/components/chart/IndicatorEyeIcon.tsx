interface IndicatorEyeIconProps {
  isVisible: boolean;
}

export default function IndicatorEyeIcon({ isVisible }: IndicatorEyeIconProps) {
  if (isVisible) {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path d="M10 4.5c-4.2 0-7.2 3.6-8.3 5.2a.75.75 0 000 .8c1.1 1.6 4.1 5.2 8.3 5.2s7.2-3.6 8.3-5.2a.75.75 0 000-.8C17.2 8.1 14.2 4.5 10 4.5zm0 8.5a3 3 0 110-6 3 3 0 010 6z" />
        <path d="M10 11.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
      </svg>
    );
  }

  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M3.28 2.22a.75.75 0 00-1.06 1.06l14.5 14.5a.75.75 0 101.06-1.06l-2.13-2.13a13.3 13.3 0 002.65-3.95.75.75 0 000-.52C17.43 7.55 14.43 4 10 4c-1.36 0-2.58.34-3.66.88L3.28 2.22zm5.1 5.1l1.08 1.08A1.75 1.75 0 0111.6 10.54l1.08 1.08a3.25 3.25 0 00-4.3-4.3z" clipRule="evenodd" />
      <path d="M4.62 6.47A13.32 13.32 0 001.7 10.12a.75.75 0 000 .52C2.57 13.21 5.57 16 10 16c.96 0 1.85-.17 2.67-.46l-2.2-2.2A3.25 3.25 0 016.66 9.53L4.62 6.47z" />
    </svg>
  );
}
