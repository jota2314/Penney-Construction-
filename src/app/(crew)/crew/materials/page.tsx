import {
  getActiveProjectsList,
  getMyMaterialOrders,
  getWarehouseItems,
} from "@/lib/actions/warehouse";
import { CrewMaterials } from "@/components/crew/crew-materials";

export default async function CrewMaterialsPage() {
  const [items, projects, myOrders] = await Promise.all([
    getWarehouseItems(),
    getActiveProjectsList(),
    getMyMaterialOrders(),
  ]);

  return (
    <div className="px-4 pt-4">
      <CrewMaterials items={items} projects={projects} myOrders={myOrders} />
    </div>
  );
}
