import { Button } from "@src/components/ui/button";

const Popup = () => {
  const openSearchPage = () => {
    chrome.tabs.create({
      url: chrome.runtime.getURL("src/pages/search/index.html"),
    });
  };

  return (
    <div className="p-4">
      <Button onClick={openSearchPage}>Open Search</Button>
    </div>
  );
};

export default Popup;
