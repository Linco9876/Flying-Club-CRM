export const getAircraftIconSrc = (iconKey?: string | null) => {
  switch ((iconKey || '').toLowerCase()) {
    case 'tecnam':
      return '/aircraft-icons/tecnam.png';
    case 'piper':
      return '/aircraft-icons/piper.png';
    case 'cessna':
      return '/aircraft-icons/cessna.png';
    case 'sling':
      return '/aircraft-icons/sling.png';
    case 'twin':
      return '/aircraft-icons/twin.png';
    default:
      return null;
  }
};
