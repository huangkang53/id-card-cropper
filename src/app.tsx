import { Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import GalleryPage from '@/pages/GalleryPage/GalleryPage';
import CropPage from '@/pages/CropPage/CropPage';
import NotFoundPage from '@/pages/NotFoundPage/NotFoundPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<GalleryPage />} />
        <Route path="crop/:id" element={<CropPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
