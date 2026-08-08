"use client";

interface MediaItem {
  name: string;
  path: string;
  date?: string;
  src: string;
  type: "image" | "video";
}

export function MediaLightbox({
  item,
  onClose,
  showDate = false,
}: {
  item: MediaItem;
  onClose: () => void;
  showDate?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/85" />
      <div
        className="relative max-w-4xl max-h-[90vh] w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-2 right-2 z-10 bg-black/60 rounded-full w-8 h-8 flex items-center justify-center text-white text-lg hover:bg-black/80"
          aria-label="Close"
        >
          &times;
        </button>
        {item.type === "image" ? (
          <img
            src={item.src}
            alt={item.name}
            className="w-full h-auto max-h-[85vh] object-contain rounded-xl"
          />
        ) : (
          <video
            src={item.src}
            controls
            autoPlay
            className="w-full h-auto max-h-[85vh] rounded-xl"
          />
        )}
        <p className="text-xs text-zinc-400 text-center mt-2 truncate">
          {showDate && item.date ? `${item.date} · ` : ""}{item.name}
        </p>
      </div>
    </div>
  );
}
