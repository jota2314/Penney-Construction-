import { requireAuth } from "@/lib/auth/require-auth";
import { getCrewEmployee } from "@/lib/actions/crew";
import {
  User,
  Phone,
  Mail,
  Shield,
  Briefcase,
  DollarSign,
  Calendar,
} from "lucide-react";
import { Card } from "@/components/ui/card";

export default async function CrewProfilePage() {
  const user = await requireAuth();
  const employee = await getCrewEmployee();

  return (
    <div className="px-4 pt-4">
      <h1 className="text-xl font-bold mb-4">My Profile</h1>

      {/* Account info */}
      <Card className="p-4 mb-4">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">
          Account
        </h2>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">
              {user.profile?.full_name || "Not set"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">{user.email}</span>
          </div>
        </div>
      </Card>

      {employee && (
        <>
          {/* Work info */}
          <Card className="p-4 mb-4">
            <h2 className="text-sm font-medium text-muted-foreground mb-3">
              Work Info
            </h2>
            <div className="space-y-3">
              {employee.title && (
                <div className="flex items-center gap-3">
                  <Briefcase className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{employee.title}</span>
                </div>
              )}
              {employee.phone && (
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{employee.phone}</span>
                </div>
              )}
              {employee.hourly_rate && (
                <div className="flex items-center gap-3">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">
                    ${employee.hourly_rate}/hr
                  </span>
                </div>
              )}
              {employee.hire_date && (
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">
                    Since{" "}
                    {new Date(employee.hire_date).toLocaleDateString("en-US", {
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                </div>
              )}
            </div>
          </Card>

          {/* Emergency contact */}
          {(employee.emergency_contact_name ||
            employee.emergency_contact_phone) && (
            <Card className="p-4">
              <h2 className="text-sm font-medium text-muted-foreground mb-3">
                Emergency Contact
              </h2>
              <div className="space-y-3">
                {employee.emergency_contact_name && (
                  <div className="flex items-center gap-3">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">
                      {employee.emergency_contact_name}
                    </span>
                  </div>
                )}
                {employee.emergency_contact_phone && (
                  <div className="flex items-center gap-3">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">
                      {employee.emergency_contact_phone}
                    </span>
                  </div>
                )}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
