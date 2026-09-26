import { Outlet } from 'react-router-dom';
import { Toaster } from 'sonner';

export const Layout = () => {
  return (
    <>
      <Outlet />
      <Toaster position="top-center" richColors />
    </>
  );
};
