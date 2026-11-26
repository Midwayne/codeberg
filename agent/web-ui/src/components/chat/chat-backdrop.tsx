import { useActiveTheme } from '../../lib/use-active-theme';
import { CustomBackdropLayers } from '../custom-backdrop';

/*
 * The scene behind the conversation. Built-in scenes are pure CSS keyed on the
 * root's data-backdrop; generated ones also draw their layers here. CSS hides
 * the element when backdrops are off.
 */
export function ChatBackdrop() {
  const { backdrop } = useActiveTheme();

  return (
    <div aria-hidden="true" className="chat-backdrop">
      {typeof backdrop === 'object' && <CustomBackdropLayers backdrop={backdrop} />}
      <span className="backdrop-quiet" />
    </div>
  );
}
