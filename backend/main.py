import os
import ssl
import requests
import paramiko
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query, BackgroundTasks, Depends
from pydantic import BaseModel, Field, model_validator
from typing import Literal
from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim
from requests.auth import HTTPBasicAuth
from dotenv import load_dotenv
import urllib3
from fastapi.middleware.cors import CORSMiddleware
import base64

from auth import create_access_token, get_current_user, hash_password, verify_password
from db import init_db, get_db
from models import User
from sqlalchemy.orm import Session
from provision import (
    create_vm_from_iso,
    list_provisioning_options,
    search_iso_files,
)


urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
load_dotenv()

ESXI_HOST = os.getenv('ESXI_HOST')
ESXI_USER = os.getenv('ESXI_USER')
ESXI_PASSWORD = os.getenv('ESXI_PASSWORD')

_cors_raw = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000",
)
CORS_ORIGINS = [o.strip() for o in _cors_raw.split(",") if o.strip()]


def bootstrap_admin_if_needed():
    from db import SessionLocal

    db = SessionLocal()
    try:
        if db.query(User).first():
            return
        u = os.getenv("INITIAL_ADMIN_USERNAME")
        p = os.getenv("INITIAL_ADMIN_PASSWORD")
        if not u or not p:
            return
        db.add(User(username=u.strip(), password_hash=hash_password(p)))
        db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    bootstrap_admin_if_needed()
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Helper functions
def connect_to_esxi():
    context = ssl._create_unverified_context()
    si = SmartConnect(
        host=ESXI_HOST,
        user=ESXI_USER,
        pwd=ESXI_PASSWORD,
        sslContext=context
    )
    return si


def delete_datastore_file(si, datastore_path, datastore_name):
    try:
        file_manager = si.content.fileManager
        delete_task = file_manager.DeleteDatastoreFile_Task(
            name=f"[{datastore_name}] {datastore_path}",
            datacenter=si.content.rootFolder.childEntity[0]  # Assumes first datacenter
        )
        while delete_task.info.state not in [vim.TaskInfo.State.success, vim.TaskInfo.State.error]:
            pass

        if delete_task.info.state == vim.TaskInfo.State.success:
            print(f"File {datastore_path} deleted successfully.")
        else:
            print(f"Failed to delete file {datastore_path}: {delete_task.info.error.msg}")
    except Exception as e:
        print(f"Error deleting file: {str(e)}")

# Pydantic models for incoming request data
class VMCommand(BaseModel):
    vm_name: str

class CloneCommand(BaseModel):
    source_vm: str
    new_vm: str


class LoginBody(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ProvisionFromIsoBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    datastore: str
    iso_path: str
    cpu: int = Field(ge=1, le=256)
    cores_per_socket: int = Field(ge=1, le=128)
    memory_mb: int = Field(ge=256, le=8_000_000)
    disk_size_mb: int = Field(ge=1024, le=67_108_864)
    disk_provisioning: Literal["thin", "lazyZeroedThick", "eagerZeroedThick"] = "thin"
    network_name: str
    guest_id: str = "ubuntu64Guest"
    boot_firmware: Literal["bios", "efi"] = "bios"
    hardware_version: str = "vmx-20"
    nic_type: Literal["vmxnet3", "e1000", "e1000e"] = "vmxnet3"
    scsi_controller_type: Literal["lsilogicsas", "lsilogic", "pvscsi"] = "lsilogicsas"
    connect_cdrom: bool = True
    connect_nic: bool = True
    boot_from_iso_first: bool = True
    cpu_hot_add: bool = False
    memory_hot_plug: bool = False
    auto_power_on: bool = False

    @model_validator(mode="after")
    def cpu_matches_cores(self):
        if self.cpu % self.cores_per_socket != 0:
            raise ValueError("cpu must be evenly divisible by cores_per_socket")
        return self


CurrentUser = Annotated[User, Depends(get_current_user)]


@app.post("/auth/login", response_model=TokenResponse)
async def login(body: LoginBody, db: Annotated[Session, Depends(get_db)]):
    user = db.query(User).filter(User.username == body.username).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return TokenResponse(access_token=create_access_token(user.username))


# API Endpoints (authenticated)
@app.get("/list")
async def list_vms(_: CurrentUser):
    si = connect_to_esxi()
    try:
        content = si.RetrieveContent()
        vms = content.viewManager.CreateContainerView(
            content.rootFolder, [vim.VirtualMachine], True).view

        vm_status_list = []
        for vm in vms:
            vm_info = {
                "id": vm._moId,
                "name": vm.name,
                "status": "running" if vm.runtime.powerState == vim.VirtualMachinePowerState.poweredOn else "stopped",
                "os": vm.config.guestFullName if vm.config else "Unknown OS",
                "memory": f"{vm.config.hardware.memoryMB // 1024}GB" if vm.config else "Unknown",
                "cpu": f"{vm.config.hardware.numCPU} vCPUs" if vm.config else "Unknown",
                "ip_address": vm.guest.ipAddress if vm.guest and vm.guest.ipAddress else "N/A"
            }
            vm_status_list.append(vm_info)

        return {"vms": vm_status_list}
    finally:
        Disconnect(si)


@app.get("/start")
async def start_vm(_: CurrentUser, vm_name: str = Query(...)):
    si = connect_to_esxi()
    try:
        content = si.RetrieveContent()
        vm = next((vm for vm in content.viewManager.CreateContainerView(
            content.rootFolder, [vim.VirtualMachine], True).view if vm.name == vm_name), None)
        if vm:
            if vm.runtime.powerState == 'poweredOff':
                vm.PowerOn()  # Start VM
                return {"message": f"Starting VM: {vm_name}"}
            else:
                return {"message": f"VM {vm_name} is already running."}
        else:
            raise HTTPException(status_code=404, detail=f"VM {vm_name} not found.")
    finally:
        Disconnect(si)

@app.get("/stop")
async def stop_vm(_: CurrentUser, vm_name: str = Query(...)):
    si = connect_to_esxi()
    try:
        content = si.RetrieveContent()
        vm = next((vm for vm in content.viewManager.CreateContainerView(
            content.rootFolder, [vim.VirtualMachine], True).view if vm.name == vm_name), None)
        if vm:
            if vm.runtime.powerState == 'poweredOn':
                vm.PowerOff()  # Stop VM
                return {"message": f"Stopping VM: {vm_name}"}
            else:
                return {"message": f"VM {vm_name} is already stopped."}
        else:
            raise HTTPException(status_code=404, detail=f"VM {vm_name} not found.")
    finally:
        Disconnect(si)

@app.get("/reset")
async def reset_vm(_: CurrentUser, vm_name: str = Query(...)):
    si = connect_to_esxi()
    try:
        content = si.RetrieveContent()
        vm = next((vm for vm in content.viewManager.CreateContainerView(
            content.rootFolder, [vim.VirtualMachine], True).view if vm.name == vm_name), None)
        if vm:
            if vm.runtime.powerState == 'poweredOn':
                vm.ResetVM_Task()  # Reset VM
                return {"message": f"Resetting VM: {vm_name}"}
            else:
                return {"message": f"VM {vm_name} is not running, so it cannot be reset."}
        else:
            raise HTTPException(status_code=404, detail=f"VM {vm_name} not found.")
    finally:
        Disconnect(si)

@app.get("/screenshot")
async def screenshot_vm(_: CurrentUser, vm_name: str = Query(...)):
    try:
        si = connect_to_esxi()
        content = si.RetrieveContent()
        vm = next((vm for vm in content.viewManager.CreateContainerView(
            content.rootFolder, [vim.VirtualMachine], True).view if vm.name == vm_name), None)

        if vm:
            if vm.runtime.powerState == 'poweredOn':
                task = vm.CreateScreenshot_Task()
                while task.info.state not in [vim.TaskInfo.State.success, vim.TaskInfo.State.error]:
                    pass

                if task.info.state == vim.TaskInfo.State.success:
                    screenshot_result = task.info.result
                    if screenshot_result.startswith("["):
                        datastore_path = screenshot_result.split('] ')[-1]
                        datastore_name = screenshot_result.split('[')[-1].split(']')[0]
                        download_url = f"https://{ESXI_HOST}/folder/{datastore_path}?dcPath=ha-datacenter&dsName={datastore_name}"
                        download_url = download_url.replace(' ', '%20')

                        response = requests.get(download_url, auth=HTTPBasicAuth(ESXI_USER, ESXI_PASSWORD), verify=False)
                        if response.status_code == 200:
                            image_base64 = base64.b64encode(response.content).decode("utf-8")
                            delete_datastore_file(si, datastore_path, datastore_name)
                            return {"message": "Screenshot taken successfully.", "screenshot": image_base64}
                        else:
                            raise HTTPException(status_code=500, detail="Failed to download the screenshot.")
                    else:
                        raise HTTPException(status_code=500, detail="Unexpected screenshot data format.")
                else:
                    raise HTTPException(status_code=500, detail="Screenshot task failed.")
            else:
                return {"message": f"VM {vm_name} is not running."}
        else:
            raise HTTPException(status_code=404, detail=f"VM {vm_name} not found.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")
    finally:
        Disconnect(si)

@app.post("/clone")
async def clone_vm(
    _: CurrentUser, command: CloneCommand, background_tasks: BackgroundTasks
):
    source_vm_name, new_vm_name = command.source_vm, command.new_vm
    si = connect_to_esxi()

    try:
        content = si.RetrieveContent()
        vm = next((vm for vm in content.viewManager.CreateContainerView(
            content.rootFolder, [vim.VirtualMachine], True).view if vm.name == source_vm_name), None)

        if not vm:
            raise HTTPException(status_code=404, detail=f"Source VM '{source_vm_name}' not found.")

        if vm.runtime.powerState == vim.VirtualMachinePowerState.poweredOn:
            raise HTTPException(status_code=400, detail=f"VM '{source_vm_name}' is running. Please power it off before cloning.")

        background_tasks.add_task(run_clone_process, source_vm_name, new_vm_name)
        return {"message": f"Cloning of VM '{new_vm_name}' from '{source_vm_name}' has started in the background."}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ERROR: {str(e)}")
    finally:
        Disconnect(si)


def run_clone_process(source_vm_name, new_vm_name):
    si = connect_to_esxi()
    try:
        content = si.RetrieveContent()

        vm = next((vm for vm in content.viewManager.CreateContainerView(
            content.rootFolder, [vim.VirtualMachine], True).view if vm.name == source_vm_name), None)

        if not vm:
            print(f"[ERROR] Source VM '{source_vm_name}' not found.")
            return

        source_vm_path = vm.config.files.vmPathName
        source_datastore_name, source_vm_folder = source_vm_path.strip("[]").split("] ")
        source_vm_folder = source_vm_folder.split("/")[0]

        disk_path = None
        for dev in vm.config.hardware.device:
            if isinstance(dev, vim.vm.device.VirtualDisk):
                if hasattr(dev.backing, 'fileName'):
                    filename = dev.backing.fileName
                    if not "-delta.vmdk" in filename:
                        disk_path = filename
                        break

        if not disk_path:
            print("[ERROR] Could not find valid .vmdk disk file for the VM.")
            return

        print(f"[DEBUG] disk_path = {disk_path}")
        disk_vmdk = disk_path.strip("[]").split("] ")[1]

        datastores = content.viewManager.CreateContainerView(
            content.rootFolder, [vim.Datastore], True).view

        if not datastores:
            print("[ERROR] No datastores found.")
            return

        best_datastore = max(datastores, key=lambda ds: ds.summary.freeSpace)
        destination_datastore_name = best_datastore.summary.name

        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(ESXI_HOST, username=ESXI_USER, password=ESXI_PASSWORD)

        steps = [
            ("Creating VM directory", f"mkdir '/vmfs/volumes/{destination_datastore_name}/{new_vm_name}'"),
            (
                "Cloning disk",
                f"vmkfstools -i '/vmfs/volumes/{source_datastore_name}/{disk_vmdk}' \
                '/vmfs/volumes/{destination_datastore_name}/{new_vm_name}/{new_vm_name}.vmdk' -d thin"
            ),
            (
                "Copying VMX file",
                f"cp '/vmfs/volumes/{source_datastore_name}/{source_vm_folder}/{source_vm_name}.vmx' \
                '/vmfs/volumes/{destination_datastore_name}/{new_vm_name}/{new_vm_name}.vmx'"
            ),
            (
                "Updating display name",
                f"sed -i 's/displayName = \"{source_vm_name}\"/displayName = \"{new_vm_name}\"/g' \
                '/vmfs/volumes/{destination_datastore_name}/{new_vm_name}/{new_vm_name}.vmx'"
            ),
            (
                "Updating VM disk reference",
                f"sed -i 's/{source_vm_name}.vmdk/{new_vm_name}.vmdk/g' \
                '/vmfs/volumes/{destination_datastore_name}/{new_vm_name}/{new_vm_name}.vmx'"
            ),
            (
                "Ensuring unique UUID",
                f"sed -i '/uuid.bios/d' \
                '/vmfs/volumes/{destination_datastore_name}/{new_vm_name}/{new_vm_name}.vmx' && \
                echo 'uuid.action = \"create\"' >> \
                '/vmfs/volumes/{destination_datastore_name}/{new_vm_name}/{new_vm_name}.vmx'"
            ),
            (
                "Registering VM",
                f"vim-cmd solo/registervm \
                '/vmfs/volumes/{destination_datastore_name}/{new_vm_name}/{new_vm_name}.vmx'"
            )
        ]

        for description, command_line in steps:
            print(f"[INFO] {description}:")
            print(f"> {command_line}")
            stdin, stdout, stderr = ssh.exec_command(command_line)
            exit_status = stdout.channel.recv_exit_status()
            if exit_status != 0:
                error = stderr.read().decode().strip()
                ssh.close()
                print(f"[ERROR] during '{description}': {error}")
                return

        ssh.close()
        print(f"[SUCCESS] Clone '{new_vm_name}' created successfully from '{source_vm_name}'")

    except Exception as e:
        print(f"[EXCEPTION] Failed to clone VM: {str(e)}")
    finally:
        Disconnect(si)

@app.get("/provision/options")
async def provision_options(_: CurrentUser):
    si = connect_to_esxi()
    try:
        return list_provisioning_options(si)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        Disconnect(si)


@app.get("/provision/isos")
async def provision_isos(
    _: CurrentUser,
    datastore: str = Query(..., description="Datastore name to search"),
    subpath: str = Query("", description="Optional subfolder under datastore"),
):
    si = connect_to_esxi()
    try:
        return {"isos": search_iso_files(si, datastore, subpath)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        Disconnect(si)


@app.post("/provision/fromiso")
async def provision_from_iso(_: CurrentUser, body: ProvisionFromIsoBody):
    si = connect_to_esxi()
    try:
        return create_vm_from_iso(
            si,
            name=body.name,
            datastore_name=body.datastore,
            iso_path=body.iso_path,
            cpu=body.cpu,
            cores_per_socket=body.cores_per_socket,
            memory_mb=body.memory_mb,
            disk_size_mb=body.disk_size_mb,
            disk_provisioning=body.disk_provisioning,
            network_name=body.network_name,
            guest_id=body.guest_id,
            boot_firmware=body.boot_firmware,
            hardware_version=body.hardware_version,
            nic_type=body.nic_type,
            scsi_controller_type=body.scsi_controller_type,
            connect_cdrom=body.connect_cdrom,
            connect_nic=body.connect_nic,
            boot_from_iso_first=body.boot_from_iso_first,
            cpu_hot_add=body.cpu_hot_add,
            memory_hot_plug=body.memory_hot_plug,
            auto_power_on=body.auto_power_on,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except vim.fault.DuplicateName as e:
        raise HTTPException(status_code=400, detail=str(e))
    except vim.fault.InvalidName as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        Disconnect(si)


@app.get("/delete")
async def delete_vm(_: CurrentUser, vm_name: str = Query(...)):
    si = connect_to_esxi()
    try:
        content = si.RetrieveContent()
        vm = next((vm for vm in content.viewManager.CreateContainerView(
            content.rootFolder, [vim.VirtualMachine], True).view if vm.name == vm_name), None)
        if not vm:
            raise HTTPException(status_code=404, detail=f"VM '{vm_name}' not found.")
        
        if vm.runtime.powerState == vim.VirtualMachinePowerState.poweredOn:
            task = vm.PowerOff()
            while task.info.state not in [vim.TaskInfo.State.success, vim.TaskInfo.State.error]:
                pass
        
        vm_path = vm.config.files.vmPathName  # Example: "[datastore1] VM_NAME/VM_NAME.vmx"
        datastore_name, vm_folder = vm_path.strip("[]").split("] ")
        vm_folder = os.path.dirname(vm_folder)
        
        vm.UnregisterVM()
        content = si.RetrieveContent()
        datastore = next((ds for ds in content.viewManager.CreateContainerView(
            content.rootFolder, [vim.Datastore], True).view if ds.name == datastore_name), None)
        
        datacenter = next((dc for dc in content.rootFolder.childEntity if isinstance(dc, vim.Datacenter)), None)
        if not datacenter:
            raise HTTPException(status_code=500, detail="No datacenter found.")
        
        if datastore:
            file_manager = content.fileManager
            delete_task = file_manager.DeleteDatastoreFile_Task(
                name=f"[{datastore_name}] {vm_folder}",
                datacenter=datacenter
            )
            while delete_task.info.state not in [vim.TaskInfo.State.success, vim.TaskInfo.State.error]:
                pass

            if delete_task.info.state == vim.TaskInfo.State.success:
                return {"message": f"VM storage '{vm_folder}' deleted from datastore '{datastore_name}'."}
            else:
                raise HTTPException(status_code=500, detail=f"Failed to delete VM storage '{vm_folder}'.")
        else:
            raise HTTPException(status_code=404, detail=f"Datastore '{datastore_name}' not found.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ERROR: Failed to delete VM: {str(e)}")
    finally:
        Disconnect(si)
