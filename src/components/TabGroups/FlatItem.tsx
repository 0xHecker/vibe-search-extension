import { useState } from "react";
import { CopyIcon } from "@icons/copy";
import { Checkmark } from "@icons/checkmark";
import { OpenArrowIcon } from "@icons/open-arrow";
import { DeleteIcon } from "@icons/delete";
import { ItemDocType } from "@src/schemas/item_schema";
import { WebIcon } from "@icons/web";

export const FlatItem = ({
  item,
  onCopy,
}: {
  item: ItemDocType;
  onCopy: (item: ItemDocType) => void;
}) => {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(item.url);
      setIsCopied(true);
      onCopy(item);
      setTimeout(() => setIsCopied(false), 5000);
    } catch (err) {
      console.error("Failed to copy URL:", err);
    }
  };

  return (
    <div className="flex flex-row gap-4 items-center group">
      <div className="flex flex-row gap-2 cursor-pointer">
        <div className="w-5 h-5 rounded-sm">
          {item.iconUrl ? (
            <img src={item.iconUrl} alt={item.title} className="w-5 h-5 rounded-sm" />
          ) : (
            <WebIcon className="w-5 h-5 rounded-sm text-foreground-icon" />
          )}
        </div>
        <span className="text-foreground-secondary group-hover:text-foreground-neutral transition-colors duration-300 text-sm line-clamp-1">
          {item.title}
        </span>
      </div>

      <div className="flex flex-row gap-1 invisible group-hover:visible transition-opacity duration-300 opacity-0 group-hover:opacity-100 text-foreground-tertiary">
        <div onClick={handleCopy} className="cursor-pointer hover:text-foreground-secondary">
          {isCopied ? (
            <Checkmark
              size={20}
              className="text-foreground-secondary animate-in fade-in-0 zoom-in-95"
            />
          ) : (
            <CopyIcon size={20} />
          )}
        </div>
        <div className="cursor-pointer hover:text-foreground-secondary transition-colors duration-300">
          <OpenArrowIcon size={20} />
        </div>
        <div className="cursor-pointer hover:text-foreground-danger transition-colors duration-300">
          <DeleteIcon size={20} />
        </div>
      </div>
    </div>
  );
};
