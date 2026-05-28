interface ScrollToLatestButtonProps {
  onClick: () => void;
}

export default function ScrollToLatestButton({ onClick }: ScrollToLatestButtonProps) {
  return (
    <button
      onClick={onClick}
      className="absolute bottom-8 right-20 z-10 w-10 h-10 bg-[#242a35]/85 hover:bg-blue-600 text-[#d1d4dc] hover:text-white rounded-full flex items-center justify-center backdrop-blur shadow-lg transition-all border border-[#3f4654] hover:border-blue-500"
      title="Scroll to latest"
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
      </svg>
    </button>
  );
}
