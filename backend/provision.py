"""
Create a new VM from a datastore ISO (pyVmomi) with options aligned to the ESXi UI.
"""
from __future__ import annotations

import re
from typing import Any

from pyVim.task import WaitForTask
from pyVmomi import vim


def wait_task(task: vim.Task) -> None:
    WaitForTask(task)


def _get_datacenter_compute(si) -> tuple[vim.Datacenter, vim.ComputeResource, vim.HostSystem]:
    content = si.RetrieveContent()
    for child in content.rootFolder.childEntity:
        if isinstance(child, vim.Datacenter):
            dc = child
            break
    else:
        raise RuntimeError("No datacenter found on this host.")

    if not dc.hostFolder.childEntity:
        raise RuntimeError("No compute resource found.")

    cr = dc.hostFolder.childEntity[0]
    if not isinstance(cr, vim.ComputeResource):
        raise RuntimeError("Unexpected host folder content (expected ComputeResource).")

    if not cr.host:
        raise RuntimeError("No host found in compute resource.")

    host = cr.host[0]
    return dc, cr, host


def _find_datastore(
    content, name: str
) -> vim.Datastore | None:
    view = content.viewManager.CreateContainerView(
        content.rootFolder, [vim.Datastore], True
    )
    try:
        for ds in view.view:
            if ds.name == name:
                return ds
    finally:
        view.Destroy()
    return None


def _find_network(host: vim.HostSystem, name: str) -> Any:
    for net in host.network:
        if net.name == name:
            return net
    return None


def _nic_backing(network_obj: Any, content) -> Any:
    if isinstance(network_obj, vim.dvs.DistributedVirtualPortgroup):
        backing = vim.vm.device.VirtualEthernetCard.DistributedVirtualPortBackingInfo()
        cfg = network_obj.config
        switch_uuid = getattr(cfg, "distributedVirtualSwitchUuid", None)
        if not switch_uuid and getattr(cfg, "distributedVirtualSwitch", None):
            mor = cfg.distributedVirtualSwitch
            view = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.dvs.VmwareDistributedVirtualSwitch], True
            )
            try:
                for dvs in view.view:
                    if dvs._moId == mor._moId:
                        switch_uuid = dvs.uuid
                        break
            finally:
                view.Destroy()
        if not switch_uuid:
            raise RuntimeError(
                "Could not resolve distributed switch UUID for this port group."
            )
        backing.port = vim.dvs.PortConnection(
            portgroupKey=network_obj.key,
            switchUuid=switch_uuid,
        )
        return backing
    backing = vim.vm.device.VirtualEthernetCard.NetworkBackingInfo()
    backing.network = network_obj
    backing.deviceName = network_obj.name
    return backing


def _scsi_controller_class(kind: str):
    if kind == "pvscsi":
        return vim.vm.device.ParaVirtualSCSIController
    if kind == "lsilogic":
        return vim.vm.device.VirtualLsiLogicController
    return vim.vm.device.VirtualLsiLogicSASController


def _nic_class(kind: str):
    if kind == "e1000":
        return vim.vm.device.VirtualE1000
    if kind == "e1000e":
        return vim.vm.device.VirtualE1000e
    return vim.vm.device.VirtualVmxnet3


def _normalize_iso_path(iso_path: str, datastore_name: str) -> str:
    s = iso_path.strip()
    if s.startswith("["):
        return s
    if not s.startswith("/"):
        s = "/" + s
    return f"[{datastore_name}]{s}"


def build_guest_os_catalog() -> list[dict[str, str]]:
    """Common guestId values (subset of VMware compatibility)."""
    return [
        {"id": "ubuntu64Guest", "label": "Ubuntu Linux (64-bit)"},
        {"id": "ubuntuGuest", "label": "Ubuntu Linux (32-bit)"},
        {"id": "debian11_64Guest", "label": "Debian GNU/Linux 11 (64-bit)"},
        {"id": "centos8_64Guest", "label": "CentOS 8 (64-bit)"},
        {"id": "centos7_64Guest", "label": "CentOS 7 (64-bit)"},
        {"id": "rhel8_64Guest", "label": "Red Hat Enterprise Linux 8 (64-bit)"},
        {"id": "rhel9_64Guest", "label": "Red Hat Enterprise Linux 9 (64-bit)"},
        {"id": "other5xLinux64Guest", "label": "Linux 5.x kernel 64-bit"},
        {"id": "other4xLinux64Guest", "label": "Linux 4.x kernel 64-bit"},
        {"id": "other3xLinux64Guest", "label": "Linux 3.x kernel 64-bit"},
        {"id": "otherLinux64Guest", "label": "Other Linux 4.x or later kernel (64-bit)"},
        {"id": "otherLinuxGuest", "label": "Other Linux (32-bit)"},
        {"id": "windows2019srv_64Guest", "label": "Microsoft Windows Server 2019 (64-bit)"},
        {"id": "windows2022srvNext_64Guest", "label": "Microsoft Windows Server 2022 (64-bit)"},
        {"id": "windows11_64Guest", "label": "Microsoft Windows 11 (64-bit)"},
        {"id": "windows10_64Guest", "label": "Microsoft Windows 10 (64-bit)"},
        {"id": "winNetStandard64Guest", "label": "Microsoft Windows Server 2008 (64-bit)"},
        {"id": "vmwarePhoton64Guest", "label": "VMware Photon OS (64-bit)"},
        {"id": "freebsd64Guest", "label": "FreeBSD 64-bit"},
        {"id": "otherGuest64", "label": "Other (64-bit)"},
        {"id": "otherGuest", "label": "Other (32-bit)"},
    ]


def list_provisioning_options(si) -> dict[str, Any]:
    content = si.RetrieveContent()
    dc, cr, host = _get_datacenter_compute(si)

    datastores: list[dict[str, Any]] = []
    for ds in host.datastore:
        try:
            free = ds.summary.freeSpace
            cap = ds.summary.capacity
        except Exception:
            free, cap = 0, 0
        datastores.append(
            {
                "name": ds.name,
                "free_space_bytes": free,
                "capacity_bytes": cap,
                "type": getattr(ds.summary, "type", ""),
            }
        )
    datastores.sort(key=lambda x: x["name"])

    networks: list[dict[str, str]] = []
    for net in host.network:
        ntype = "distributed" if isinstance(net, vim.dvs.DistributedVirtualPortgroup) else "standard"
        networks.append({"name": net.name, "type": ntype})
    networks.sort(key=lambda x: x["name"])

    return {
        "datacenter": dc.name,
        "host_name": host.name,
        "datastores": datastores,
        "networks": networks,
        "guest_os": build_guest_os_catalog(),
        "hardware_versions": [
            {"id": "vmx-11", "label": "ESXi 5.0 / HW 11"},
            {"id": "vmx-13", "label": "ESXi 6.0 / HW 13"},
            {"id": "vmx-14", "label": "ESXi 6.5 / HW 14"},
            {"id": "vmx-15", "label": "ESXi 6.7 / HW 15"},
            {"id": "vmx-17", "label": "ESXi 7.0 U2 / HW 17"},
            {"id": "vmx-18", "label": "ESXi 7.0 U3 / HW 18"},
            {"id": "vmx-19", "label": "ESXi 8.0 / HW 19"},
            {"id": "vmx-20", "label": "ESXi 8.0 U2 / HW 20"},
            {"id": "vmx-21", "label": "ESXi 8.0 U3 / HW 21"},
        ],
        "scsi_controller_types": [
            {"id": "lsilogicsas", "label": "LSI Logic SAS (default)"},
            {"id": "lsilogic", "label": "LSI Logic Parallel"},
            {"id": "pvscsi", "label": "VMware Paravirtual"},
        ],
        "nic_types": [
            {"id": "vmxnet3", "label": "VMXNET3 (recommended)"},
            {"id": "e1000e", "label": "E1000E"},
            {"id": "e1000", "label": "E1000 (legacy)"},
        ],
        "disk_provisioning": [
            {"id": "thin", "label": "Thin provision"},
            {"id": "lazyZeroedThick", "label": "Thick lazy zeroed"},
            {"id": "eagerZeroedThick", "label": "Thick eager zeroed"},
        ],
    }


def _combine_datastore_iso_path(folder_path: str, file_path: str) -> str:
    """Build [ds] relative/path/file.iso from SearchDatastoreSubFolders results."""
    folder_path = folder_path.strip()
    file_path = file_path.strip()
    if not folder_path.startswith("["):
        return f"[{folder_path}] {file_path}"
    if "]" in folder_path:
        a, b = folder_path.split("]", 1)
        b = b.strip().strip("/")
        if b:
            return f"{a}] {b}/{file_path}".replace("//", "/")
        return f"{a}] {file_path}"
    return folder_path


def search_iso_files(si, datastore_name: str, subpath: str = "") -> list[dict[str, Any]]:
    """Search a VMFS/NFS datastore for *.iso files (recursive from subpath)."""
    content = si.RetrieveContent()
    ds = _find_datastore(content, datastore_name)
    if not ds:
        raise RuntimeError(f"Datastore '{datastore_name}' not found.")

    browser = ds.browser
    search_spec = vim.host.DatastoreBrowser.SearchSpec()
    search_spec.matchPattern = ["*.iso"]
    search_spec.details = vim.host.DatastoreBrowser.FileInfo.Details()
    search_spec.details.fileSize = True
    search_spec.details.fileType = True
    search_spec.details.modification = True
    search_spec.searchCaseInsensitive = True

    sub = subpath.strip().strip("/")
    if sub:
        ds_path = f"[{datastore_name}] {sub}"
    else:
        ds_path = f"[{datastore_name}]"

    task = browser.SearchDatastoreSubFolders_Task(
        datastorePath=ds_path,
        searchSpec=search_spec,
    )
    wait_task(task)

    out: list[dict[str, Any]] = []
    if task.info.result is None:
        return out

    for res in task.info.result:
        folder = getattr(res, "folderPath", "") or ""
        for f in getattr(res, "file", []) or []:
            path = getattr(f, "path", None)
            if not path:
                continue
            iso_path = _combine_datastore_iso_path(folder, path)
            size = getattr(f, "fileSize", 0)
            out.append({"path": iso_path, "size_bytes": size})

    out.sort(key=lambda x: x["path"].lower())
    return out


def create_vm_from_iso(
    si,
    *,
    name: str,
    datastore_name: str,
    iso_path: str,
    cpu: int,
    cores_per_socket: int,
    memory_mb: int,
    disk_size_mb: int,
    disk_provisioning: str,
    network_name: str,
    guest_id: str,
    boot_firmware: str,
    hardware_version: str,
    nic_type: str,
    scsi_controller_type: str,
    connect_cdrom: bool,
    connect_nic: bool,
    boot_from_iso_first: bool,
    cpu_hot_add: bool,
    memory_hot_plug: bool,
    auto_power_on: bool,
) -> dict[str, Any]:
    if not re.match(r"^[a-zA-Z0-9_.-]{1,80}$", name):
        raise ValueError(
            "VM name must be 1–80 chars: letters, digits, dot, underscore, hyphen."
        )

    content = si.RetrieveContent()
    dc, cr, host = _get_datacenter_compute(si)
    vm_folder = dc.vmFolder
    resource_pool = cr.resourcePool

    ds = _find_datastore(content, datastore_name)
    if not ds:
        raise ValueError(f"Datastore '{datastore_name}' not found.")

    net = _find_network(host, network_name)
    if not net:
        raise ValueError(f"Network '{network_name}' not found on host.")

    iso_full = _normalize_iso_path(iso_path, datastore_name)

    # Verify VM name uniqueness
    vview = content.viewManager.CreateContainerView(
        content.rootFolder, [vim.VirtualMachine], True
    )
    try:
        for vm in vview.view:
            if vm.name == name:
                raise ValueError(f"A virtual machine named '{name}' already exists.")
    finally:
        vview.Destroy()

    scsi_class = _scsi_controller_class(scsi_controller_type)
    nic_class = _nic_class(nic_type)

    # Device keys (fixed for boot order references)
    scsi_key = 1000
    disk_key = 2000
    nic_key = 4000
    sata_key = 15000
    cdrom_key = 16000

    device_changes: list[vim.vm.device.VirtualDeviceConfigSpec] = []

    # SCSI controller + disk
    scsi_ctrl = scsi_class()
    scsi_ctrl.key = scsi_key
    scsi_ctrl.busNumber = 0
    scsi_ctrl.sharedBus = vim.vm.device.VirtualSCSISharing.noSharing
    scsi_spec = vim.vm.device.VirtualDeviceConfigSpec()
    scsi_spec.operation = vim.vm.device.VirtualDeviceConfigSpecOperation.add
    scsi_spec.device = scsi_ctrl
    device_changes.append(scsi_spec)

    disk = vim.vm.device.VirtualDisk()
    disk.key = disk_key
    disk.unitNumber = 0
    disk.controllerKey = scsi_key
    disk.capacityInKB = int(disk_size_mb) * 1024

    disk_backing = vim.vm.device.VirtualDisk.FlatVer2BackingInfo()
    disk_backing.diskMode = vim.vm.device.VirtualDiskOption.DiskMode.persistent
    disk_backing.fileName = f"[{datastore_name}] {name}/{name}.vmdk"

    if disk_provisioning == "thin":
        disk_backing.thinProvisioned = True
    elif disk_provisioning == "eagerZeroedThick":
        disk_backing.thinProvisioned = False
        disk_backing.eagerlyScrub = True
    else:
        disk_backing.thinProvisioned = False
        disk_backing.eagerlyScrub = False

    disk.backing = disk_backing

    disk_spec = vim.vm.device.VirtualDeviceConfigSpec()
    disk_spec.operation = vim.vm.device.VirtualDeviceConfigSpecOperation.add
    disk_spec.fileOperation = vim.vm.device.VirtualDeviceConfigSpecFileOperation.create
    disk_spec.device = disk
    device_changes.append(disk_spec)

    # NIC
    nic = nic_class()
    nic.key = nic_key
    nic.backing = _nic_backing(net, content)
    nic.addressType = "assigned"
    if connect_nic:
        nic.connectable = vim.vm.device.VirtualDevice.ConnectInfo(
            startConnected=True,
            connected=True,
            allowGuestControl=True,
        )
    else:
        nic.connectable = vim.vm.device.VirtualDevice.ConnectInfo(
            startConnected=False,
            connected=False,
            allowGuestControl=True,
        )

    nic_spec = vim.vm.device.VirtualDeviceConfigSpec()
    nic_spec.operation = vim.vm.device.VirtualDeviceConfigSpecOperation.add
    nic_spec.device = nic
    device_changes.append(nic_spec)

    # SATA AHCI + CD-ROM (ISO)
    sata = vim.vm.device.VirtualAHCIController()
    sata.key = sata_key
    sata.busNumber = 0
    sata_spec = vim.vm.device.VirtualDeviceConfigSpec()
    sata_spec.operation = vim.vm.device.VirtualDeviceConfigSpecOperation.add
    sata_spec.device = sata
    device_changes.append(sata_spec)

    cdrom = vim.vm.device.VirtualCdrom()
    cdrom.key = cdrom_key
    cdrom.controllerKey = sata_key
    cdrom.unitNumber = 0
    iso_backing = vim.vm.device.VirtualCdromIsoBackingInfo()
    iso_backing.fileName = iso_full
    cdrom.backing = iso_backing
    if connect_cdrom:
        cdrom.connectable = vim.vm.device.VirtualDevice.ConnectInfo(
            startConnected=True,
            connected=True,
            allowGuestControl=True,
        )
    else:
        cdrom.connectable = vim.vm.device.VirtualDevice.ConnectInfo(
            startConnected=False,
            connected=False,
            allowGuestControl=True,
        )

    cdrom_spec = vim.vm.device.VirtualDeviceConfigSpec()
    cdrom_spec.operation = vim.vm.device.VirtualDeviceConfigSpecOperation.add
    cdrom_spec.device = cdrom
    device_changes.append(cdrom_spec)

    config = vim.vm.ConfigSpec()
    config.name = name
    config.guestId = guest_id
    config.numCPUs = cpu
    config.numCoresPerSocket = cores_per_socket
    config.memoryMB = memory_mb
    config.cpuHotAddEnabled = cpu_hot_add
    config.memoryHotAddEnabled = memory_hot_plug
    config.version = hardware_version

    if boot_firmware == "efi":
        config.firmware = "efi"
    else:
        config.firmware = "bios"

    files = vim.vm.FileInfo()
    files.vmPathName = f"[{datastore_name}] {name}/{name}.vmx"
    config.files = files

    config.deviceChange = device_changes

    if boot_from_iso_first:
        boot_cd = vim.vm.BootOptions.BootDeviceOrder()
        boot_cd.deviceKey = cdrom_key
        boot_disk = vim.vm.BootOptions.BootDeviceOrder()
        boot_disk.deviceKey = disk_key
        config.bootOptions = vim.vm.BootOptions()
        config.bootOptions.bootOrder = [boot_cd, boot_disk]

    task = vm_folder.CreateVM_Task(
        config=config,
        pool=resource_pool,
        host=host,
    )
    wait_task(task)

    # Locate new VM
    vm = None
    vview2 = content.viewManager.CreateContainerView(
        content.rootFolder, [vim.VirtualMachine], True
    )
    try:
        for o in vview2.view:
            if o.name == name:
                vm = o
                break
    finally:
        vview2.Destroy()

    if not vm:
        raise RuntimeError("VM was created but could not be found after task completion.")

    if auto_power_on:
        ptask = vm.PowerOnVM_Task()
        wait_task(ptask)

    return {
        "message": f"VM '{name}' created from ISO.",
        "vm_name": name,
        "power_state": str(vm.runtime.powerState),
    }
