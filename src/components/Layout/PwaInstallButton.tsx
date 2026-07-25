import React from 'react';
import { Download } from 'lucide-react';
import toast from 'react-hot-toast';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const installed = () =>
  window.matchMedia('(display-mode: standalone)').matches
  || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);

export const PwaInstallButton: React.FC = () => {
  const [prompt, setPrompt] = React.useState<InstallPromptEvent>();
  const [isInstalled, setInstalled] = React.useState(installed);

  React.useEffect(() => {
    const capture = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const complete = () => {
      setPrompt(undefined);
      setInstalled(true);
    };
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', complete);
    return () => {
      window.removeEventListener('beforeinstallprompt', capture);
      window.removeEventListener('appinstalled', complete);
    };
  }, []);

  if (isInstalled) return null;

  const install = async () => {
    if (!prompt) {
      toast('On iPhone or iPad, open Share and choose “Add to Home Screen”. On other browsers, use Install app in the browser menu.', { duration: 7000 });
      return;
    }
    await prompt.prompt();
    await prompt.userChoice;
    setPrompt(undefined);
  };

  return (
    <button
      type="button"
      onClick={() => void install()}
      className="rounded-full border border-transparent p-2 text-gray-500 transition-colors hover:border-gray-200 hover:bg-gray-50 hover:text-blue-700 dark:text-gray-300 dark:hover:border-[#363b45] dark:hover:bg-[#11141a] dark:hover:text-blue-200"
      title="Install portal"
      aria-label="Install Bendigo Flying Club Portal"
    >
      <Download className="h-5 w-5 sm:h-4 sm:w-4" aria-hidden="true" />
    </button>
  );
};
