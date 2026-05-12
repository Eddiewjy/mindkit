import { Routes, Route, Navigate } from 'react-router-dom'
import { SpaceList } from '@/pages/SpaceList'
import { KitWorkspace } from '@/pages/KitWorkspace'

/** 主应用 */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<SpaceList />} />
      <Route path="/kit/:id" element={<KitWorkspace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
