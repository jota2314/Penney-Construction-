"use client";

import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { EmployeeFormDialog } from "./employee-form-dialog";
import { EmployeeDeleteDialog } from "./employee-delete-dialog";
import { EmployeeStatusBadge } from "./employee-status-badge";
import { formatCurrency } from "@/lib/utils";
import type { Employee } from "@/types/database";

interface EmployeeListProps {
  employees: Employee[];
}

export function EmployeeList({ employees }: EmployeeListProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);
  const [deleteEmp, setDeleteEmp] = useState<Employee | null>(null);

  const filtered = useMemo(() => {
    let list = employees;

    if (statusFilter !== "all") {
      list = list.filter((e) => e.status === statusFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.first_name.toLowerCase().includes(q) ||
          e.last_name.toLowerCase().includes(q) ||
          e.title?.toLowerCase().includes(q) ||
          e.phone?.toLowerCase().includes(q)
      );
    }

    return list;
  }, [employees, search, statusFilter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search employees..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => setFormOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Employee
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden md:table-cell">Title</TableHead>
              <TableHead className="hidden md:table-cell">Phone</TableHead>
              <TableHead className="hidden md:table-cell">Status</TableHead>
              <TableHead className="hidden lg:table-cell">
                Hourly Rate
              </TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-muted-foreground py-8"
                >
                  {employees.length === 0
                    ? "No employees yet. Add your first employee to get started."
                    : "No employees match your search."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((emp) => (
                <TableRow key={emp.id}>
                  <TableCell className="font-medium">
                    {emp.first_name} {emp.last_name}
                    {emp.title && (
                      <div className="md:hidden text-xs text-muted-foreground mt-0.5">
                        {emp.title}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {emp.title ?? "—"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {emp.phone ?? "—"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <EmployeeStatusBadge status={emp.status} />
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {emp.hourly_rate != null
                      ? `${formatCurrency(emp.hourly_rate, "two")}/hr`
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditEmployee(emp)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteEmp(emp)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <EmployeeFormDialog open={formOpen} onOpenChange={setFormOpen} />

      {editEmployee && (
        <EmployeeFormDialog
          open={!!editEmployee}
          onOpenChange={(open) => {
            if (!open) setEditEmployee(null);
          }}
          employee={editEmployee}
        />
      )}

      {deleteEmp && (
        <EmployeeDeleteDialog
          open={!!deleteEmp}
          onOpenChange={(open) => {
            if (!open) setDeleteEmp(null);
          }}
          employee={deleteEmp}
        />
      )}
    </div>
  );
}
